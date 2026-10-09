import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { groupSchema, type BankGroup } from '../shared/contracts';
import { hash, safeFile } from './bank';

const paperId=z.string().regex(/^ky1-\d{4}$/);
const manifestSchema=z.object({
  schema_version:z.literal(1),exam:z.literal('KY1'),source_site:z.url(),count:z.literal(17),
  papers:z.array(z.object({paper_id:paperId,year:z.number().int().min(2010).max(2026),set:z.literal(1),file_path:z.string(),content_status:z.string(),answer_status:z.string(),source_sha256:z.string().regex(/^[a-f0-9]{64}$/),source_path:z.string(),title:z.string(),group_count:z.literal(9),question_count:z.literal(52),answers_verified:z.literal(45)}).strict())
}).strict();
const answerSchema=z.object({question_id:z.string(),number:z.number().int().min(1).max(45),correct_answer:z.string().regex(/^[A-H]$/),verification_status:z.literal('verified'),sources:z.object({analysis_page:z.string(),quickref_table:z.string()}).strict(),provenance:z.string().min(1),extraction_method:z.literal('dual-source-crosscheck')}).strict();
const answerDocSchema=z.object({schema_version:z.literal(1),exam:z.literal('KY1'),paper_id:paperId,year:z.number().int(),source_site:z.string(),markdown_sha256:z.string().regex(/^[a-f0-9]{64}$/),retrieved_at:z.iso.datetime({offset:true}),answers:z.array(answerSchema).length(45)}).strict();
const analysisQuestionSchema=z.object({question_id:z.string(),number:z.number().int().min(1).max(52),kind:z.enum(['cloze','reading','matching','translation','writing']),answer:z.string().nullish(),qtype:z.string().nullish(),blocks:z.array(z.record(z.string(),z.unknown())).optional(),writing:z.record(z.string(),z.unknown()).optional()}).passthrough();
const analysisDocSchema=z.object({schema_version:z.literal(1),exam:z.literal('KY1'),paper_id:paperId,year:z.number().int(),questions:z.record(z.string(),analysisQuestionSchema),page_context:z.unknown().optional()}).passthrough();
const auditSchema=z.object({schema_version:z.literal(1),exam:z.literal('KY1'),papers:z.record(z.string(),z.object({questions_with_analysis:z.literal(52),numbers:z.array(z.number().int()).length(52),block_counts:z.record(z.string(),z.number().int().positive())}).passthrough()),missing:z.array(z.unknown()).length(0),totals:z.object({papers:z.literal(17),questions:z.literal(884),analysis_blocks:z.literal(3163)}).passthrough()}).passthrough();
const contractSchema=z.object({adapter:z.literal('workbuddy-ky1-markdown-v1'),schema_sha256:z.string(),manifest_sha256:z.string(),handoff_sha256:z.string()}).strict();

type ParsedQuestion={number:number;stem:string;options:{key:string;text:string}[]};
type ParsedGroup={id:string;kind:BankGroup['kind'];passage:string[];candidates:{key:string;text:string}[];questions:ParsedQuestion[]};

function frontmatter(text:string) {
  const normalized=text.replace(/^\uFEFF/,'');const lines=normalized.split(/\r?\n/);
  if(lines[0]!=='---')throw new Error('Missing KY1 Markdown front matter');
  const end=lines.indexOf('---',1);if(end<0)throw new Error('Unclosed KY1 Markdown front matter');
  const values=Object.fromEntries(lines.slice(1,end).flatMap(line=>{const m=line.match(/^([a-z_0-9]+):\s*(.*)$/);return m?[[m[1],m[2]]]:[];}));
  return {values,lines:lines.slice(end+1)};
}
const clean=(lines:string[])=>lines.map(line=>line.trim()).filter(line=>line&&!line.startsWith('<!--')&&!/^\*\*Directions:\*\*/.test(line)&&line!=='---');
function paragraphs(lines:string[]) {
  const out:string[]=[];let current:string[]=[];let candidates=false;let segments=false;
  const flush=()=>{const value=current.join(' ').replace(/\s+/g,' ').trim();if(value)out.push(value);current=[];};
  for(const raw of lines){const line=raw.trim();if(!line){flush();continue;}if(line==='**Candidates:**'){flush();candidates=true;segments=false;continue;}if(line==='**Segments to translate:**'){flush();segments=true;candidates=false;continue;}if(/^##### /.test(line))break;if(candidates||segments)continue;if(line.startsWith('<!--')||/^\*\*Directions:\*\*/.test(line)||line==='---')continue;current.push(line.replace(/^\*(.*)\*$/,'$1'));}flush();return out;
}
function candidates(lines:string[]) {
  const start=lines.findIndex(line=>line.trim()==='**Candidates:**');if(start<0)return [];
  const result:{key:string;text:string}[]=[];
  for(const raw of lines.slice(start+1)){if(/^##### /.test(raw)||/^\*\*Segments/.test(raw))break;const m=raw.trim().match(/^- ([A-H])\.\s+(.+)$/);if(m)result.push({key:m[1],text:m[2]});}
  return result;
}
function questions(lines:string[],paper:string,kind:BankGroup['kind'],wordbank:{key:string;text:string}[],body:string[]):ParsedQuestion[] {
  const starts=lines.flatMap((line,index)=>/^##### Question (\d+)$/.test(line.trim())?[index]:[]);const result:ParsedQuestion[]=[];
  for(let i=0;i<starts.length;i++){
    const block=lines.slice(starts[i],starts[i+1]??lines.length);const number=Number(block[0].trim().match(/\d+$/)?.[0]);
    const options=block.flatMap(line=>{const m=line.trim().match(/^- ([A-H])\.\s+(.+)$/);return m?[{key:m[1],text:m[2]}]:[]});
    const stem=clean(block.slice(1)).filter(line=>!line.startsWith('- ')).join(' ').trim()
      || (kind==='matching'?(body.find(p=>new RegExp(`^\\(${number}\\)`).test(p))?.replace(/^\(\d+\)\s*_+\s*/,'').trim()||`选择与第 ${number} 项匹配的选项`):kind==='writing'?body.join('\n\n'):`第 ${number} 题`);
    if(!Number.isInteger(number)||`${paper}-q${number}`.length>200)throw new Error(`Invalid question heading in ${paper}`);
    result.push({number,stem,options:kind==='matching'?wordbank:options});
  }
  return result;
}
function parsePaperMarkdown(text:string,paperIdValue:string):ParsedGroup[]{
  const {lines}=frontmatter(text);const groups:ParsedGroup[]=[];let previousBoundary=0;
  for(let i=0;i<lines.length;i++){
    if(/^## /.test(lines[i])){previousBoundary=i+1;}
    else if(/^### /.test(lines[i])){previousBoundary=i+1;}
    const match=lines[i].match(/^#### Group: (ky1-\d{4}-(cloze|reading|matching|translation|writing)-[abc]-\d{2})$/);if(!match)continue;
    const next=lines.findIndex((line,j)=>j>i&&(/^(?:## |### |#### Group:)/.test(line)));const end=next<0?lines.length:next;
    const groupLines=lines.slice(i+1,end);const firstQuestion=groupLines.findIndex(line=>/^##### Question /.test(line));const beforeQuestions=groupLines.slice(0,firstQuestion<0?groupLines.length:firstQuestion);
    const sourceKind=match[2];const kind:BankGroup['kind']=sourceKind==='cloze'?'use_of_english':sourceKind==='reading'?'careful':sourceKind as BankGroup['kind'];
    const sectionPreamble=lines.slice(previousBoundary,i);const passageLines=(sourceKind==='cloze'||sourceKind==='writing')?[...sectionPreamble,...beforeQuestions]:beforeQuestions;
    const directions=sectionPreamble.find(line=>line.startsWith('**Directions:**'))?.replace('**Directions:**','').trim();
    const passage=[...(directions?[directions]:[]),...paragraphs(passageLines)];const wordbank=candidates(beforeQuestions);const parsedQuestions=questions(groupLines,paperIdValue,kind,wordbank,passage);
    groups.push({id:match[1],kind,passage,questions:parsedQuestions,candidates:wordbank});previousBoundary=end;
    i=end-1;
  }
  return groups;
}
function blockText(block:Record<string,unknown>) {
  return [block.core,block.detail,block.text,block.zh,block.explain].filter(v=>typeof v==='string'&&v.trim()).join(' ');
}
function normalizeExplanation(question:z.infer<typeof analysisQuestionSchema>,paragraphRows:{id:string;text:string}[],answer?:string) {
  const blocks=question.blocks??[];const writing=question.writing;
  const summary=blocks.map(blockText).find(Boolean)
    ?? (writing&&typeof writing==='object'&&writing.essay&&typeof writing.essay==='object'&&'note' in writing.essay?String(writing.essay.note):'逐题解析与参考范文')
    ?? '逐题解析';
  const evidence=blocks.flatMap(block=>block.type==='locate'&&typeof block.en==='string'?paragraphRows.flatMap(p=>p.text.includes(block.en as string)?[{paragraph_id:p.id,text:block.en as string}]:[]):[]);
  const distractors:Record<string,string>={};
  for(const block of blocks){
    const options=Array.isArray(block.options)?block.options:[];
    for(const item of options){if(!item||typeof item!=='object')continue;const row=item as Record<string,unknown>;const key=typeof row.letter==='string'?(row.letter.match(/[A-H]/)?.[0]??''):'';if(key&&key!==answer)distractors[key]=[row.judge,row.note,row.detail].filter(v=>typeof v==='string').join(' ');}
    const rivals=Array.isArray(block.rivals)?block.rivals:[];
    for(const item of rivals){if(!item||typeof item!=='object')continue;const row=item as Record<string,unknown>;const key=typeof row.letter==='string'?(row.letter.match(/[A-H]/)?.[0]??''):'';if(key&&key!==answer)distractors[key]=[row.why,row.detail].filter(v=>typeof v==='string').join(' ');}
  }
  return {question_id:question.question_id,explanation:summary,keyword_relation:question.qtype||'来源逐题解析',evidence,distractor_explanations:distractors,skill_tags:[question.qtype||question.kind],verification_status:'verified' as const,analysis:question};
}

export async function inspectKy1Bank(root:string) {
  const [schema,manifestText,handoff]=await Promise.all([safeFile(root,'docs/ky1-markdown-schema.md'),safeFile(root,'data/markdown/KY1_manifest.json'),safeFile(root,'KY1_HANDOFF.md')]);
  const manifest=manifestSchema.parse(JSON.parse(manifestText));const commit=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  return {commit,schema_sha256:hash(schema),manifest_sha256:hash(manifestText),handoff_sha256:hash(handoff),paper_count:manifest.count,manifest};
}

export async function validateKy1Bank(root:string,contractPath='docs/ky1-source-contract.json') {
  const inspected=await inspectKy1Bank(root);const contract=contractSchema.parse(JSON.parse((await readFile(contractPath,'utf8')).replace(/^\uFEFF/,'')));
  if(contract.schema_sha256!==inspected.schema_sha256||contract.manifest_sha256!==inspected.manifest_sha256||contract.handoff_sha256!==inspected.handoff_sha256)throw new Error('KY1 source contract changed. Review the handoff, schema and manifest before updating ky1-source-contract.json.');
  const dirty=execFileSync('git',['-C',root,'status','--porcelain','--','data/markdown/KY1','data/markdown/KY1_manifest.json','data/answers/KY1','data/analyses/KY1','data/audit/KY1_answer_sources.json','data/audit/KY1_analysis_sources.json','docs/ky1-markdown-schema.md','KY1_HANDOFF.md'],{encoding:'utf8'}).trim();
  if(dirty)throw new Error('KY1 source data, audit, schema or handoff has uncommitted changes; commit first.');
  const audit=auditSchema.parse(JSON.parse(await safeFile(root,'data/audit/KY1_analysis_sources.json')));const groups:BankGroup[]=[];const errors:{path:string;message:string}[]=[];const seenQuestions=new Set<string>();let verifiedAnswers=0,analysisQuestions=0,analysisBlocks=0;
  for(const entry of inspected.manifest.papers){const path=`data/markdown/${entry.file_path}`;try{
    const [markdown,answersText,analysisText]=await Promise.all([safeFile(root,path),safeFile(root,`data/answers/KY1/${entry.paper_id}.json`),safeFile(root,`data/analyses/KY1/${entry.paper_id}.json`)]);
    const fm=frontmatter(markdown).values;if(fm.exam!=='KY1'||fm.paper_id!==entry.paper_id||Number(fm.year)!==entry.year||fm.source_sha256!==entry.source_sha256)throw new Error('Markdown/manifest identity or provenance mismatch');
    const answerDoc=answerDocSchema.parse(JSON.parse(answersText));const analysisDoc=analysisDocSchema.parse(JSON.parse(analysisText));
    if(answerDoc.paper_id!==entry.paper_id||analysisDoc.paper_id!==entry.paper_id||answerDoc.year!==entry.year||analysisDoc.year!==entry.year||answerDoc.markdown_sha256!==hash(markdown))throw new Error('Answer/analysis paper identity or Markdown hash mismatch');
    const answerMap=new Map(answerDoc.answers.map(a=>[a.question_id,a]));const parsedGroups=parsePaperMarkdown(markdown,entry.paper_id);
    if(answerMap.size!==45||Object.keys(analysisDoc.questions).length!==52)throw new Error('Duplicate answers or unexpected analysis questions');
    for(let number=1;number<=52;number++){const a=analysisDoc.questions[String(number)];if(!a||a.question_id!==`${entry.paper_id}-q${number}`)throw new Error('Analysis identity mismatch');if(number<=45&&a.answer!==answerMap.get(a.question_id)?.correct_answer)throw new Error(`Analysis/verified answer mismatch ${a.question_id}`);}
    if(parsedGroups.length!==9||parsedGroups.flatMap(g=>g.questions).length!==52)throw new Error(`Expected 9 groups/52 questions, got ${parsedGroups.length}/${parsedGroups.flatMap(g=>g.questions).length}`);
    const auditPaper=audit.papers[entry.paper_id];if(!auditPaper)throw new Error('Missing analysis audit paper');
    for(const parsed of parsedGroups){
      const paragraphRows=parsed.passage.map((text,index)=>({id:`${parsed.id}-p${String(index+1).padStart(2,'0')}`,label:String(index+1),position:index,text:parsed.kind==='use_of_english'?text.replace(/\[\[blank:(\d+)\]\]/g,'{{$1}}'):text}));
      const normalized=groupSchema.parse({id:parsed.id,paper:{id:entry.paper_id,exam:'KY1',year:entry.year,month:0,set:1},kind:parsed.kind,title:`${entry.year} 年考研英语一 · ${{cloze:'选词填空',use_of_english:'完形填空',careful:'阅读理解',matching:'新题型',translation:'翻译',writing:'写作'}[parsed.kind]}`,passage:{id:`${parsed.id}-passage`,paragraphs:paragraphRows,word_bank:parsed.candidates},questions:parsed.questions.map(q=>({id:`${entry.paper_id}-q${q.number}`,number:q.number,stem:q.stem,options:q.options,paragraph_ids:[]})),content_status:'complete',question_status:'complete',release_status:'released',version:hash(markdown+answersText+analysisText+parsed.id).slice(0,16),source:{repository:'workbuddy-ky1',path,commit:inspected.commit,hash:hash(markdown+answersText+analysisText),raw_repository:'https://english-exam.lazynote.cn/kaoyan/downloads/',raw_path:entry.source_path,raw_hash:entry.source_sha256,markdown_path:path},answers:parsed.questions.flatMap(q=>{const id=`${entry.paper_id}-q${q.number}`;const a=answerMap.get(id);if(q.number<=45&&!a)throw new Error(`Missing verified answer ${id}`);if(!a)return[];if(!q.options.some(o=>o.key===a.correct_answer)||a.sources.analysis_page!==a.correct_answer||a.sources.quickref_table!==a.correct_answer)throw new Error(`Answer/options/source mismatch ${id}`);verifiedAnswers++;return[{question_id:id,correct_answer:a.correct_answer,source:'lazynote analysis page + quick-reference table',verification_status:'verified',verified_at:answerDoc.retrieved_at,answer_version:hash(JSON.stringify(a)),notes:a.provenance}];}),explanations:parsed.questions.map(q=>{const id=`${entry.paper_id}-q${q.number}`;if(seenQuestions.has(id))throw new Error(`Duplicate question ID ${id}`);seenQuestions.add(id);const analysis=analysisDoc.questions[String(q.number)];if(!analysis||analysis.question_id!==id||analysis.number!==q.number)throw new Error(`Missing or mismatched analysis ${id}`);const count=(analysis.blocks?.length??0)+(analysis.writing?Object.keys(analysis.writing).filter(key=>key!=='page_url').length:0);if(count!==auditPaper.block_counts[String(q.number)])throw new Error(`Analysis block audit mismatch ${id}: ${count} != ${auditPaper.block_counts[String(q.number)]}`);analysisQuestions++;analysisBlocks+=count;const expectedKind=parsed.kind==='use_of_english'?'cloze':parsed.kind==='careful'?'reading':parsed.kind;if(analysis.kind!==expectedKind)throw new Error(`Analysis kind mismatch ${id}`);const explanation=normalizeExplanation(analysis,paragraphRows,answerMap.get(id)?.correct_answer);return parsed.kind==='translation'?{...explanation,analysis:{...analysis,page_context:analysisDoc.page_context}}:explanation;})});
      groups.push(normalized);
    }
  }catch(error){errors.push({path,message:error instanceof Error?error.message:String(error)});}}
  if(seenQuestions.size!==884||verifiedAnswers!==765||analysisQuestions!==audit.totals.questions||analysisBlocks!==audit.totals.analysis_blocks)errors.push({path:'KY1 aggregate',message:`Expected 884 questions / 765 answers / 3163 blocks, got ${seenQuestions.size} / ${verifiedAnswers} / ${analysisBlocks}`});
  return {groups,errors,quarantine:[],commit:inspected.commit,repository:'workbuddy-ky1',sourceHash:hash(groups.map(g=>g.source.hash).join('')),coverage:{papers:inspected.paper_count,verified_explanations:analysisQuestions,reading_groups:groups.length,source_questions:seenQuestions.size,source_verified_answers:verifiedAnswers,normalized_groups:groups.length,quarantined_groups:0,release_ready:groups.filter(g=>!['translation','writing'].includes(g.kind)).length,analysis_blocks:analysisBlocks}};
}
