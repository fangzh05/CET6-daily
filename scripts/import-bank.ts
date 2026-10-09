import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { inspectBank, validateBank } from './bank';
import { databaseGuard } from './db-guard';
import { isEligible } from '../shared/contracts';
const arg = (name: string) => { const i=process.argv.indexOf(name); return i<0 ? undefined : process.argv[i+1]; };
const root = arg('--bank') || process.env.QUESTION_BANK_PATH;
try {
  if (!root) throw new Error('Missing question bank. Supply --bank <real-repository-path>. No built-in or synthetic bank is used.');
  if (process.argv.includes('--inspect')) { console.log(JSON.stringify(await inspectBank(resolve(root)),null,2)); }
  else {
    const result=await validateBank(resolve(root),arg('--contract')??'docs/source-contract.json');
    const report={commit:result.commit,coverage:result.coverage,groups:result.groups.map(g=>({id:g.id,eligible:isEligible(g),questions:g.questions.length})),quarantine:result.quarantine,errors:result.errors};
    await mkdir('reports',{recursive:true}); await writeFile('reports/import-validation.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2)); if (result.errors.length) throw new Error('Validation failed. No database writes were made.');
    if (process.argv.includes('--import')) {
      const production=process.argv.includes('--production-reviewed');
      if(production&&arg('--expected-commit')!==result.commit)throw new Error('Production import requires --expected-commit matching the reviewed source SHA.');
      const db=drizzle({client:neon(databaseGuard(process.env,production))});
      const batchId=crypto.randomUUID();
      await db.execute(sql`insert into import_batches(id,repository,commit,source_hash,status,report) values(${batchId}::uuid,${result.repository},${result.commit},${result.sourceHash},'running',${JSON.stringify(report)}::jsonb)`);
      try {
        const concurrency=Math.max(1,Math.min(16,Number(arg('--concurrency')??8)));
        for (let i=0;i<result.groups.length;i+=concurrency) {
          const chunk=result.groups.slice(i,i+concurrency);
          const outcomes=await Promise.allSettled(chunk.map(g=>db.execute(sql`select cet6_import(${JSON.stringify(g)}::jsonb,${batchId}::uuid)`)));
          const failures=outcomes.filter(x=>x.status==='rejected');
          if(failures.length)throw new Error(`${failures.length}/${chunk.length} group imports failed: ${outcomes.flatMap((x,index)=>x.status==='rejected'?[`${chunk[index].id}: ${x.reason?.cause?.message??x.reason?.message??'unknown database error'}`]:[]).join('; ')}`);
        }
        await db.execute(sql`update import_batches set status='completed' where id=${batchId}::uuid`);
        console.log(`Imported ${result.groups.length} groups. Batch ${batchId}.`);
      } catch (error) {
        await db.execute(sql`update import_batches set status='failed' where id=${batchId}::uuid`).catch(()=>{});
        throw error;
      }
    } else if (!process.argv.includes('--validate')) throw new Error('Choose --inspect, --validate or --import.');
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1; }
