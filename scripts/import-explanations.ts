import { explanationValidationSql as valid } from './explanation-sql';
import { neon } from '@neondatabase/serverless';
import { databaseGuard } from './db-guard';
import { validateBank } from './bank';
const index=process.argv.indexOf('--bank');
const root=process.argv[index+1];
if(index<0||!root)throw new Error('Supply --bank');
const bank=await validateBank(root);
if(bank.errors.length)throw new Error('Bank validation failed');
const production=process.argv.includes('--production-reviewed');
if(production&&process.argv[process.argv.indexOf('--expected-commit')+1]!==bank.commit)throw new Error('Expected source commit required');
const client=neon(databaseGuard(process.env,production));
const records=bank.groups.flatMap(g=>g.explanations.map(e=>({...e,group_id:g.id,stem:g.questions.find(q=>q.id===e.question_id)!.stem,options:g.questions.find(q=>q.id===e.question_id)!.options,correct_answer:g.answers.find(a=>a.question_id===e.question_id)!.correct_answer})));
const payload=JSON.stringify(records);
const [{count}]=await client.query(`select count(*)::int count from (${valid}) v`,[payload]);
console.log(JSON.stringify({expected:records.length,matched:count,environment:production?'production':'development'}));
if(count!==records.length)throw new Error('Database content mismatch; no explanation writes made');
if(!process.argv.includes('--import'))process.exit(0);
// All guards run again in the same transaction as the upsert. No content/history writes.
const sources=JSON.stringify(bank.groups.map(g=>({group_id:g.id,sources:g.source.explanation_sources})));
const result=await client.transaction([
  client.query(`with v as (${valid}) select 1/(case when count(*)=$2::int then 1 else 0 end) guard from v`,[payload,records.length]),
  client.query(`insert into explanations(question_id,explanation,keyword_relation,evidence,distractors,skill_tags,verification_status)
    select r->>'question_id',r->>'explanation',r->>'keyword_relation',r->'evidence',r->'distractor_explanations',r->'skill_tags','verified' from jsonb_array_elements($1::jsonb) r
    on conflict(question_id) do update set explanation=excluded.explanation,keyword_relation=excluded.keyword_relation,evidence=excluded.evidence,distractors=excluded.distractors,skill_tags=excluded.skill_tags,verification_status=excluded.verification_status
    returning question_id`,[payload]),
  client.query(`update source_references s set metadata=s.metadata || jsonb_build_object('explanation_sources',r->'sources')
    from jsonb_array_elements($1::jsonb) r where s.group_id=r->>'group_id'`,[sources])
],{isolationLevel:'Serializable'});
console.log(`Imported ${result[1].length} verified explanations atomically.`);
