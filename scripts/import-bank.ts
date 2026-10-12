import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { inspectBank, validateBank } from './bank';
import { inspectKy1Bank, validateKy1Bank } from './ky1-bank';
import { inspectJlptN1Bank, validateJlptN1Bank } from './jlpt-n1-bank';
import { databaseGuard } from './db-guard';
import { isEligible } from '../shared/contracts';
const arg = (name: string) => { const i=process.argv.indexOf(name); return i<0 ? undefined : process.argv[i+1]; };
const root = arg('--bank') || process.env.QUESTION_BANK_PATH;
try {
  if (!root) throw new Error('Missing question bank. Supply --bank <real-repository-path>. No built-in or synthetic bank is used.');
  const exam=(arg('--exam')??'CET6').toUpperCase();if(!['CET6','KY1','JLPT_N1'].includes(exam))throw new Error('--exam must be CET6, KY1 or JLPT_N1.');
  const contract=arg('--contract')??(exam==='KY1'?'docs/ky1-source-contract.json':exam==='JLPT_N1'?'docs/jlpt-n1-markdown-contract.json':'docs/source-contract.json');
  if (process.argv.includes('--inspect')) { console.log(JSON.stringify(exam==='KY1'?await inspectKy1Bank(resolve(root)):exam==='JLPT_N1'?await inspectJlptN1Bank(resolve(root),contract):await inspectBank(resolve(root)),null,2)); }
  else {
    const result=exam==='KY1'?await validateKy1Bank(resolve(root),contract):exam==='JLPT_N1'?await validateJlptN1Bank(resolve(root),contract):await validateBank(resolve(root),contract);
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
        const byPaper=new Map<string,typeof result.groups>();
        for(const group of result.groups){const rows=byPaper.get(group.paper.id)??[];rows.push(group);byPaper.set(group.paper.id,rows);}
        const papers=[...byPaper.values()];
        for (let i=0;i<papers.length;i+=concurrency) {
          const chunk=papers.slice(i,i+concurrency);
          const outcomes=await Promise.allSettled(chunk.map(async groups=>{
            for(const group of groups){
              try{await db.execute(sql`select cet6_import(${JSON.stringify(group)}::jsonb,${batchId}::uuid)`);}
              catch(error){throw new Error(`${group.id}: ${error instanceof Error?error.message:String(error)}`);}
            }
          }));
          const failures=outcomes.filter(x=>x.status==='rejected');
          if(failures.length)throw new Error(`${failures.length}/${chunk.length} paper imports failed: ${outcomes.flatMap(x=>x.status==='rejected'?[x.reason?.message??'unknown database error']:[]).join('; ')}`);
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
