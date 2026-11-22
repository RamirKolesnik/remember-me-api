// Applies db/migrations/*.sql in name order, each once, inside a transaction.
import pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadConfig } from '../config.ts'

export async function migrate(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  const applied: string[] = []
  try {
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
    const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name))
    const dir = join(import.meta.dirname, '..', '..', 'db', 'migrations')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      if (done.has(file)) continue
      const sql = await readFile(join(dir, file), 'utf8')
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into schema_migrations (name) values ($1)', [file])
        await client.query('commit')
        applied.push(file)
      } catch (err) {
        await client.query('rollback')
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
      }
    }
  } finally {
    await client.end()
  }
  return applied
}

if (process.argv[1] === import.meta.filename) {
  const applied = await migrate(loadConfig().databaseUrl)
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date')
}
