import { it, expect } from 'vitest';
import { groupSchema,isEligible } from '../shared/contracts';
import { fixture } from './fixture';
import { parseStructuredPaper } from '../scripts/bank';
it('pending keys remain excluded without blocking other verified groups',()=>{const ready=fixture();expect(isEligible(ready)).toBe(true);ready.answers[0].verification_status='pending';expect(isEligible(ready)).toBe(false);});
it('rejects nonexistent evidence, invalid correct option, duplicated IDs and incomplete complete groups',()=>{
  const g=fixture();g.explanations[0].evidence[0].text='This quotation does not exist.';expect(groupSchema.safeParse(g).success).toBe(false);
  const answer=fixture();answer.answers[0].correct_answer='X';expect(groupSchema.safeParse(answer).success).toBe(false);
  const duplicate=fixture();duplicate.questions[1].id=duplicate.questions[0].id;expect(groupSchema.safeParse(duplicate).success).toBe(false);
  const missing=fixture();missing.questions.pop();expect(groupSchema.safeParse(missing).success).toBe(false);
});
it('does not guess unrecognized source formats',()=>{expect(()=>parseStructuredPaper('# CET6\n51. A/B/C/D')).toThrow();expect(()=>parseStructuredPaper('{"schema_version":3}')).toThrow();});
it('verified keys require timestamps; complete cloze requires each original blank exactly once',()=>{const g=fixture();g.answers[0].verified_at=null;expect(groupSchema.safeParse(g).success).toBe(false);const c=fixture('cloze');c.passage.paragraphs[0].text=c.passage.paragraphs[0].text.replace('{{26}}','');expect(groupSchema.safeParse(c).success).toBe(false);});
