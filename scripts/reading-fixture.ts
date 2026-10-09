import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import { questionSchema, paragraphSchema } from '../shared/contracts';

export const reviewSchema = z.object({questionId:z.string(),correctOptionId:z.enum(['A','B','C','D']),evidence:z.array(z.object({paragraphId:z.string(),text:z.string().min(1)})),explanation:z.string(),distractorExplanations:z.record(z.string(),z.string())});
export function parseReadingFixture(markdown:string) {
  const match=markdown.replace(/\r\n/g,'\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if(!match) throw new Error('Missing fixture metadata');
  const meta=z.object({id:z.string(),title:z.string(),subtitle:z.string(),questions:z.array(questionSchema.omit({paragraph_ids:true})).length(5),reviews:z.array(reviewSchema).length(5)}).parse(parse(match[1]));
  const used=new Set<string>();
  const paragraphs=match[2].trim().split(/\n\s*\n/).map((block,position)=>{
    const anchor=block.match(/^<!-- id: ([\w-]+) -->\n/);const text=block.replace(/^<!-- id: [\w-]+ -->\n/,'').trim();
    const base=anchor?.[1]??`p-${createHash('sha256').update(text.normalize('NFKC').replace(/\s+/g,' ')).digest('hex').slice(0,16)}`;
    let id=base;let suffix=1;while(used.has(id)){if(anchor)throw new Error('Duplicate explicit anchor');id=`${base}-${++suffix}`;}used.add(id);
    return paragraphSchema.parse({id,text,label:String(position+1).padStart(2,'0'),position});
  });
  if(new Set(meta.questions.map(q=>q.id)).size!==5||new Set(meta.questions.map(q=>q.number)).size!==5||new Set(meta.reviews.map(r=>r.questionId)).size!==5)throw new Error('Duplicate question/review');
  for(const q of meta.questions)if(q.options.map(o=>o.key).sort().join('')!=='ABCD')throw new Error('Four unique options required');
  for(const r of meta.reviews){const q=meta.questions.find(q=>q.id===r.questionId);if(!q||!q.options.some(o=>o.key===r.correctOptionId))throw new Error('Invalid answer link');for(const e of r.evidence)if(!paragraphs.some(p=>p.id===e.paragraphId&&p.text.includes(e.text)))throw new Error('Invalid evidence');for(const o of q.options)if(o.key!==r.correctOptionId&&!r.distractorExplanations[o.key])throw new Error('Missing distractor');}
  return {publicData:{id:meta.id,title:meta.title,subtitle:meta.subtitle,paragraphs,questions:meta.questions.map(q=>({...q,paragraph_ids:[]}))},reviews:meta.reviews};
}
export function generateReadingFixture(){
  const data=parseReadingFixture(readFileSync('fixtures/reading/quiet-city.md','utf8'));
  mkdirSync('src/reading',{recursive:true});
  writeFileSync('src/reading/fixture.generated.ts',`// Generated at build time from the original fixture. Do not edit.\nexport default ${JSON.stringify(data.publicData,null,2)};\n`);
  writeFileSync('src/reading/review.mock.generated.ts',`// MOCK ONLY. Never use for production bank data. Loaded after prototype submission.\nimport type { ReadingQuestionReview } from './types';\nconst reviews:ReadingQuestionReview[]=${JSON.stringify(data.reviews,null,2)};\nexport default reviews;\n`);
}
