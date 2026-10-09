import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { explanationSchema, optionSchema, groupSchema, type BankGroup } from '../shared/contracts';

const recordSchema=explanationSchema.extend({correct_answer:z.string(),stem:z.string(),options:z.array(optionSchema)}).strict();
const sourceSchema=z.object({group_id:z.string(),url:z.url().refine(url=>/^https:\/\/english-exam\.lazynote\.cn\/cet6\/sections\//.test(url)),sha256:z.string().regex(/^[a-f0-9]{64}$/),records:z.array(recordSchema)}).strict();
const overlaySchema=z.object({schema_version:z.literal(1),provider:z.literal('lazynote'),groups:z.array(sourceSchema)}).strict();
export async function loadExplanations(path='data/explanations/lazynote.json') {
    const parsed=overlaySchema.parse(JSON.parse(await readFile(path,'utf8')));
    if(new Set(parsed.groups.map(g=>g.group_id)).size!==parsed.groups.length)throw new Error('Duplicate explanation groups');
    return parsed.groups;
}
export function attachExplanations(group:BankGroup, source:z.infer<typeof sourceSchema>):BankGroup {
  if(source.group_id!==group.id)throw new Error('Explanation group identity mismatch');
  for(const record of source.records) {
    const q=group.questions.find(q=>q.id===record.question_id);
    const answer=group.answers.find(a=>a.question_id===record.question_id);
    if(!q||q.stem!==record.stem||JSON.stringify(q.options)!==JSON.stringify(record.options)||answer?.correct_answer!==record.correct_answer)throw new Error(`Explanation question/answer mismatch: ${record.question_id}`);
  }
  const explanations=source.records.map(({correct_answer,stem,options,...explanation})=>explanation);
  const digest=createHash('sha256').update(JSON.stringify(source)).digest('hex');
  return groupSchema.parse({...group,explanations,version:createHash('sha256').update(group.version+digest).digest('hex').slice(0,16),source:{...group.source,hash:createHash('sha256').update(group.source.hash+digest).digest('hex'),explanation_sources:[{url:source.url,sha256:source.sha256,method:'html_rp_ana_exact_evidence_v1'}]}});
}
