import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../worker/db';
import type { BankGroup } from '../shared/contracts';
export async function testDatabase() {
  const pg=new PGlite();
  for(const m of readMigrationFiles({migrationsFolder:'./db/migrations'})) for(const statement of m.sql) await pg.exec(statement);
  const dialect=new PgDialect();
  const db:Database={async query<T extends Record<string,unknown>>(statement: SQL){const compiled=dialect.sqlToQuery(statement);try{return (await pg.query<T>(compiled.sql,compiled.params)).rows;}catch(e){console.error('isolated_test_sql_error',e instanceof Error?e.message:e);throw e;}}};
  return {pg,db};
}
export async function importFixture(db:Database,group:BankGroup) {
  const id=crypto.randomUUID();
  await db.query(sql`insert into import_batches(id,repository,commit,source_hash,status,report) values(${id}::uuid,'test-only',${'a'.repeat(40)},${'b'.repeat(64)},'running','{}')`);
  await db.query(sql`select cet6_import(${JSON.stringify(group)}::jsonb,${id}::uuid)`);
  return id;
}
