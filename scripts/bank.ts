import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { groupSchema, type BankGroup } from '../shared/contracts';
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function safeFile(root:string,path:string) {
  const realRoot=await realpath(root);const target=await realpath(resolve(realRoot,path));const rel=relative(realRoot,target);
  if(rel.startsWith('..')||isAbsolute(rel))throw new Error(`Source path leaves question bank: ${path}`);
  return readFile(target,'utf8');
}
const paperId=z.string().regex(/^cet6-\d{4}-(06|07|09|12)-0[1-3]$/);
const status=z.enum(['verified','needs_review','unusable']);
const option=z.object({label:z.string(),text:z.string()}).strict();
const rawAnswer=z.object({question_id:z.string(),number:z.number().int().optional(),correct_answer:z.string().nullable(),source:z.string().nullable(),source_sha256:z.string().optional(),extraction_method:z.string().optional(),evidence:z.string().optional(),candidate_answer:z.string().optional(),verification_status:z.enum(['verified','missing','needs_review']),verified_at:z.string().nullable(),reviewer_note:z.string().optional()}).strict();
const rawQuestion=z.object({question_id:z.string(),number:z.number().int(),kind:z.enum(['mcq','matching','blank']),stem:z.string(),options:z.array(option),content_status:status,answer_status:z.enum(['verified','missing']),issues:z.array(z.string()),answer:rawAnswer,source_ref:z.object({markdown:z.string(),group_id:z.string(),number:z.number().int()}).strict()}).strict();
const rawGroup=z.object({group_id:z.string(),part:z.string(),section:z.string(),title:z.string(),content_status:status,issues:z.array(z.string()),passage:z.object({marker:z.string(),banner:z.string().nullable(),paragraphs:z.array(z.object({index:z.number().int().positive(),label:z.string(),text:z.string()}).strict())}).strict(),wordbank:z.array(option),questions:z.array(rawQuestion)}).strict();
const rawPaper=z.object({schema_version:z.literal(2),exam:z.literal('CET6'),paper_id:paperId,year:z.number().int(),month:z.union([z.literal(6),z.literal(7),z.literal(9),z.literal(12)]),set:z.number().int().min(1).max(3),title:z.string(),content_status:z.enum(['verified','needs_review','draft']),answer_status:z.enum(['verified','missing']),source:z.object({repo:z.string(),path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),markdown:z.string()}).strict(),rollup:z.record(z.string(),z.number()),sections:z.array(z.object({part:z.string(),label:z.string().nullable(),name:z.string(),present:z.boolean(),directions:z.string(),body:z.array(z.string()),groups:z.array(rawGroup)}).strict())}).strict();
const manifestSchema=z.object({schema_version:z.literal(1),exam:z.literal('CET6'),source_repo:z.string(),stage2_generated_at:z.string().optional(),stage2_totals:z.record(z.string(),z.number()).optional(),count:z.number().int(),papers:z.array(z.object({paper_id:paperId,year:z.number(),month:z.number(),set:z.number(),file_path:z.string(),source_sha256:z.string(),source_path:z.string()}).passthrough())}).strict();
const usableSchema=z.object({schema_version:z.literal(2),rule:z.string(),generated_at:z.string(),count:z.number().int(),groups:z.array(z.object({paper_id:paperId,group_id:z.string(),part:z.string(),section:z.string(),question_ids:z.array(z.string())}).strict())}).strict();
const supplementalSource=z.object({url:z.url(),sha256:z.string().regex(/^[a-f0-9]{64}$/),method:z.literal('ooxml_paragraphs'),verification_status:z.literal('needs_review')});
const recoverySchema=z.record(paperId,z.array(z.object({section:z.enum(['A','B','C']),status:z.enum(['recovered_needs_review','unresolved']),groups:z.array(z.string()).optional(),source:supplementalSource.extend({shared_section_claim:z.object({paper_id:paperId,source:supplementalSource,status:z.literal('provider_claim_needs_review')}).optional()})}).passthrough()));
async function supplementalAudit(root:string) {
  let raw:string;
  try {raw=await safeFile(root,'data/audit/reference_completion.json');}
  catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return {};throw error;}
  const recovery=recoverySchema.parse(JSON.parse(raw));
  const pins=z.array(z.object({paper_id:paperId,url:z.url(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough()).parse(JSON.parse(await safeFile(root,'data/audit/reference_pins.json')));
  if(new Set(pins.map(p=>p.paper_id)).size!==pins.length)throw new Error('Duplicate supplemental reference pin');
  for(const [pid,records] of Object.entries(recovery))for(const record of records) {
    const references=[{paper_id:pid,...record.source},...(record.source.shared_section_claim?[{paper_id:record.source.shared_section_claim.paper_id,...record.source.shared_section_claim.source}]:[])];
    for(const reference of references)if(!pins.some(pin=>pin.paper_id===reference.paper_id&&pin.url===reference.url&&pin.sha256===reference.sha256))throw new Error(`Unpinned supplemental source: ${pid}`);
    if(record.groups?.some(id=>!id.startsWith(`${pid}-reading-${record.section.toLowerCase()}-`)))throw new Error(`Supplemental group identity mismatch: ${pid}`);
  }
  return recovery;
}
export const parseStructuredPaper=(text:string)=>rawPaper.parse(JSON.parse(text));
function frontmatter(text:string):Record<string,unknown> {
  // Article/questions are read from structured JSON; only Markdown metadata is parsed.
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);if(lines[0]!=='---')throw new Error('Missing Markdown YAML metadata');
  const end=lines.indexOf('---',1);if(end<0)throw new Error('Unclosed Markdown metadata');
  return z.record(z.string(),z.unknown()).parse(parseYaml(lines.slice(1,end).join('\n')));
}
export async function inspectBank(root:string) {
  const schema=await safeFile(root,'docs/markdown-schema.md');const structuredSchema=await safeFile(root,'docs/structured-schema.md');
  const manifest=manifestSchema.parse(JSON.parse(await safeFile(root,'data/markdown/manifest.json')));
  const usable=usableSchema.parse(JSON.parse(await safeFile(root,'data/structured/usable_groups.json')));
  const commit=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const sample=manifest.papers.find(p=>p.paper_id==='cet6-2025-12-01')??manifest.papers[0];
  return {commit,markdown_schema_sha256:hash(schema),structured_schema_sha256:hash(structuredSchema),paper_count:manifest.count,release_ready_count:usable.count,manifest,usable,sample:sample?parseStructuredPaper(await safeFile(root,`data/structured/${sample.paper_id}.json`)):null};
}
export async function validateBank(root:string,contractPath='docs/source-contract.json') {
  const inspected=await inspectBank(root);
  const contract=z.object({adapter:z.literal('workbuddy-structured-v2'),markdown_schema_sha256:z.string(),structured_schema_sha256:z.string()}).strict().parse(JSON.parse((await readFile(contractPath,'utf8')).replace(/^\uFEFF/,'')));
  if(contract.markdown_schema_sha256!==inspected.markdown_schema_sha256||contract.structured_schema_sha256!==inspected.structured_schema_sha256)throw new Error('Source schema changed. Read both schemas and review the adapter before updating source-contract.json.');
  const dirty=execFileSync('git',['-C',root,'status','--porcelain','--','data','docs/markdown-schema.md','docs/structured-schema.md'],{encoding:'utf8'}).trim();if(dirty)throw new Error('Question-bank data or schema has uncommitted changes; commit first.');
  const {manifest,usable}=inspected;if(manifest.count!==manifest.papers.length||new Set(manifest.papers.map(p=>p.paper_id)).size!==manifest.count)throw new Error('Manifest count/unique IDs mismatch');
  const recovery=await supplementalAudit(root);
  if(usable.count!==usable.groups.length||new Set(usable.groups.map(g=>g.group_id)).size!==usable.count)throw new Error('Usable group count/IDs mismatch');
  const index=JSON.parse(await safeFile(root,'data/structured/index.json')) as {schema_version:number;papers:{paper_id:string}[]};
  if(index.schema_version!==2||index.papers.length!==manifest.count||index.papers.some(p=>!manifest.papers.some(m=>m.paper_id===p.paper_id)))throw new Error('Structured index does not match manifest');
  const groups:BankGroup[]=[];const errors:{path:string;message:string}[]=[];const quarantine:{group_id:string;reason:string}[]=[];const releaseSeen=new Set<string>();const seenIds=new Set<string>();
  let readingGroups=0;let verifiedAnswers=0;let sourceQuestions=0;
  for(const entry of manifest.papers) {
    const file=`data/structured/${entry.paper_id}.json`;
    try {
      const text=await safeFile(root,file);const paper=parseStructuredPaper(text);
      const md=await safeFile(root,`data/markdown/${entry.file_path}`);const fm=frontmatter(md);
      if(paper.paper_id!==entry.paper_id||paper.year!==entry.year||paper.month!==entry.month||paper.set!==entry.set||paper.source.sha256!==entry.source_sha256||paper.source.path!==entry.source_path||paper.source.markdown!==entry.file_path||fm.paper_id!==paper.paper_id||fm.source_sha256!==paper.source.sha256)throw new Error('Markdown/manifest/structured provenance or paper identity mismatch');
      const answersText=await safeFile(root,`data/answers/${paper.paper_id}.json`);
      const answerDoc=z.object({schema_version:z.literal(2),exam:z.literal('CET6'),paper_id:paperId,answers:z.array(rawAnswer)}).strict().parse(JSON.parse(answersText));
      if(answerDoc.paper_id!==paper.paper_id||new Set(answerDoc.answers.map(a=>a.question_id)).size!==answerDoc.answers.length)throw new Error('Answer paper/IDs mismatch');
      const answerMap=new Map(answerDoc.answers.map(a=>[a.question_id,a]));const allQuestions=paper.sections.flatMap(s=>s.groups.flatMap(g=>g.questions));
      sourceQuestions+=allQuestions.length;verifiedAnswers+=allQuestions.filter(q=>q.answer.verification_status==='verified').length;
      for(const section of paper.sections)for(const g of section.groups) {
        for(const q of g.questions) {
          if(seenIds.has(q.question_id))throw new Error(`Duplicate question ID: ${q.question_id}`);seenIds.add(q.question_id);
          const ext=answerMap.get(q.question_id);
          if(q.question_id!==`${g.group_id}-q${q.number}`||q.source_ref.group_id!==g.group_id||q.source_ref.number!==q.number||q.source_ref.markdown!==paper.source.markdown)throw new Error(`Question ID/source_ref mismatch: ${q.question_id}`);
          if(!ext||ext.correct_answer!==q.answer.correct_answer||ext.verification_status!==q.answer.verification_status||ext.source!==q.answer.source||ext.source_sha256!==q.answer.source_sha256)throw new Error(`Embedded/external answer mismatch: ${q.question_id}`);
          if(ext.number!==undefined&&ext.number!==q.number)throw new Error(`Answer number mismatch: ${q.question_id}`);
        }
        if(section.part!=='III')continue;readingGroups++;
        if(g.part!==section.part||g.section!==section.label||!['A','B','C'].includes(g.section))throw new Error('Reading group/section mismatch');
        const release=usable.groups.find(r=>r.group_id===g.group_id);
        const ready=g.content_status==='verified'&&g.questions.length>0&&g.questions.every(q=>q.content_status==='verified'&&q.answer_status==='verified');
        if(release) {releaseSeen.add(g.group_id);if(!ready||release.paper_id!==paper.paper_id||release.question_ids.join(',')!==g.questions.map(q=>q.question_id).join(','))throw new Error(`Released group does not match verified source: ${g.group_id}`);}
        const kind=g.section==='A'?'cloze':g.section==='B'?'matching':'careful';
        const recovered=recovery[paper.paper_id]?.find(record=>record.status==='recovered_needs_review'&&record.groups?.includes(g.group_id));
        const supplemental_sources=recovered?[{url:recovered.source.url,sha256:recovered.source.sha256,method:recovered.source.method,verification_status:recovered.source.verification_status},...(recovered.source.shared_section_claim?[{...recovered.source.shared_section_claim.source,shared_from_paper_id:recovered.source.shared_section_claim.paper_id}]:[])]:undefined;
        const supplementalHash=supplemental_sources?JSON.stringify(supplemental_sources):'';
        const word_bank=g.wordbank.map(w=>({key:w.label,text:w.text}));
        const paragraphs=g.passage.paragraphs.map(p=>({id:`${g.group_id}-p${String(p.index).padStart(2,'0')}`,label:p.label||String(p.index),position:p.index-1,text:kind==='cloze'?p.text.replace(/\[\[blank:(\d+)\]\]/g,'{{$1}}'):p.text}));
        const range=g.passage.banner?.match(/Questions (\d+) to (\d+)/i);
        if(kind==='careful'&&range&&g.questions.map(q=>q.number).join(',')!==Array.from({length:Number(range[2])-Number(range[1])+1},(_,i)=>i+Number(range[1])).join(',')) {quarantine.push({group_id:g.group_id,reason:'Question range does not match passage banner'});if(release)throw new Error('Released group has mismatched question range');continue;}
        try {
          const normalized=groupSchema.parse({
            id:g.group_id,paper:{id:paper.paper_id,year:paper.year,month:paper.month,set:paper.set},kind,title:`${paper.year} 年 ${paper.month} 月 · ${g.title||section.name}`,
            passage:{id:`${g.group_id}-passage`,paragraphs,word_bank},
            questions:g.questions.map(q=>({id:q.question_id,number:q.number,stem:kind==='cloze'?`选择第 ${q.number} 空的词汇`:q.stem,options:kind==='matching'?paragraphs.map(p=>({key:p.label,text:`Paragraph ${p.label}`})):kind==='cloze'?word_bank:q.options.map(o=>({key:o.label,text:o.text})),paragraph_ids:[]})),
            content_status:g.content_status==='verified'?'complete':'incomplete',question_status:g.questions.every(q=>q.content_status==='verified')?'complete':'incomplete',release_status:release?'released':'pending',version:hash(text+answersText+supplementalHash).slice(0,16),
            source:{repository:'cet6-question-bank',path:file,commit:inspected.commit,hash:hash(text+answersText+md+supplementalHash),raw_repository:paper.source.repo,raw_path:paper.source.path,raw_hash:paper.source.sha256,markdown_path:`data/markdown/${paper.source.markdown}`,supplemental_sources},
            answers:g.questions.filter(q=>q.answer_status==='verified'&&q.answer.verification_status==='verified').map(q=>{const a=q.answer;if(!a.correct_answer||!a.source||!a.source_sha256||!a.verified_at)throw new Error(`${q.question_id}: incomplete verified metadata`);return{question_id:q.question_id,correct_answer:a.correct_answer,source:a.source,verification_status:'verified',verified_at:/^\d{4}-\d{2}-\d{2}$/.test(a.verified_at)?`${a.verified_at}T00:00:00Z`:a.verified_at,answer_version:hash(JSON.stringify(a)),notes:a.reviewer_note};}),
            explanations:[]
          });groups.push(normalized);
        }catch(error){const message=error instanceof Error?error.message:String(error);quarantine.push({group_id:g.group_id,reason:message});if(release)throw new Error(`Released group invalid: ${message}`);}
      }
    }catch(error){errors.push({path:file,message:error instanceof Error?error.message:String(error)});}
  }
  for(const release of usable.groups)if(release.part==='III'&&!releaseSeen.has(release.group_id))errors.push({path:'usable_groups.json',message:`Orphan released group ${release.group_id}`});
  return {groups,errors,quarantine,commit:inspected.commit,repository:'cet6-question-bank',sourceHash:hash(groups.map(g=>g.source.hash).join('')),coverage:{papers:manifest.count,reading_groups:readingGroups,source_questions:sourceQuestions,source_verified_answers:verifiedAnswers,normalized_groups:groups.length,quarantined_groups:quarantine.length,release_ready:groups.filter(g=>g.release_status==='released').length}};
}


