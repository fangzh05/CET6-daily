import { neon } from '@neondatabase/serverless';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { databaseGuard } from './db-guard';
const production=process.argv.includes('--production-reviewed');
const client=neon(databaseGuard(process.env,production,true));
// All pending statements and journal entries share one Neon HTTP transaction.
await client.transaction([
  client.query('CREATE SCHEMA IF NOT EXISTS drizzle',[]),
  client.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint UNIQUE NOT NULL)',[])
]);
const applied=await client.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',[]);
const migrations=readMigrationFiles({migrationsFolder:'./db/migrations'});
for(const row of applied) {
  const file=migrations.find(m=>m.folderMillis===Number(row.created_at));
  if(!file || file.hash!==row.hash) throw new Error('Applied migration changed. Restore the deployed file and create a new migration.');
}
const latest=applied.length?Number(applied[applied.length-1].created_at):0;
const pending=migrations.filter(m=>m.folderMillis>latest);
if(pending.length) {
  const statements=[
    client.query("SELECT pg_advisory_xact_lock(hashtext('cet6-migrations'))",[]),
    client.query(`DO $$ BEGIN IF COALESCE((SELECT max(created_at) FROM drizzle.__drizzle_migrations),0) <> ${latest} THEN RAISE EXCEPTION 'MIGRATIONS_CHANGED_RETRY'; END IF; END $$`,[])
  ];
  for(const migration of pending) {
    for(const statement of migration.sql.filter(s=>s.trim())) statements.push(client.query(statement,[]));
    statements.push(client.query('INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)',[migration.hash,migration.folderMillis]));
  }
  await client.transaction(statements);
}
console.log(`Versioned ${production?'production':'development'} migrations applied atomically (${pending.length} new).`);
