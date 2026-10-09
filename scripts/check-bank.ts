// Local acceptance probe only: uses disposable PostgreSQL, never a business database.
import { validateBank } from './bank';
import { testDatabase,importFixture } from '../tests/database';
import { Repository } from '../worker/repository';
import { mkdir,writeFile } from 'node:fs/promises';
const path=process.argv[2]??process.env.QUESTION_BANK_PATH;
if(!path)throw new Error('Supply the real question-bank path');
const bank=await validateBank(path);if(bank.errors.length)throw new Error(JSON.stringify(bank.errors));
const {pg,db}=await testDatabase();
try {
  for(const group of bank.groups)await importFixture(db,group);
  for(const group of bank.groups)await importFixture(db,group);
  const repo=new Repository(db);const user=await repo.user({identity:'isolated-real-bank-check',email:'test@example.invalid'});
  const available=await repo.daily(user.id,50);const counts=await pg.query('select (select count(*) from papers)::int papers,(select count(*) from question_groups)::int groups,(select count(*) from questions)::int questions,(select count(*) from answer_keys)::int answers,(select count(*) from question_groups where eligible)::int eligible');
  const report={source:bank.coverage,git_commit:bank.commit,imported:counts.rows[0],daily_recommendations:available.length,idempotent:true,test_engine:'isolated PGlite PostgreSQL; not Neon connectivity proof'};
  await mkdir('reports',{recursive:true});await writeFile('reports/real-bank-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(available.length!==bank.coverage.release_ready)throw new Error('Source release filter mismatch');
}finally{await pg.close();}
