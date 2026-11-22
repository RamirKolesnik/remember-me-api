// Database tests: run against a real PostgreSQL through the psql CLI.
// Set TEST_DATABASE_URL to a server you can create databases on, e.g.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const admin = process.env.TEST_DATABASE_URL
const skip = admin ? false : 'TEST_DATABASE_URL is not set'
const dbName = `rm_test_${process.pid}`
let url = ''

function psql(target: string, args: string[]): string {
  return execFileSync('psql', [target, '-tAX', '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}
const sql = (q: string) => psql(url, ['-c', q])

function sqlError(q: string): string {
  try {
    sql(q)
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e)
  }
  return ''
}

const reserve = (x: number, y: number, size: number, holder: string, minutes = 15) =>
  `select reserve_frame(${x}, ${y}, ${size}, 1, 30, 'Test', 'hi', null, '${holder}', ${minutes})`

before(() => {
  if (!admin) return
  psql(admin, ['-c', `create database ${dbName}`])
  const u = new URL(admin)
  u.pathname = `/${dbName}`
  url = u.toString()
  const dir = join(import.meta.dirname, '..', 'db', 'migrations')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    psql(url, ['-f', join(dir, f)])
  }
})

after(() => {
  if (admin) psql(admin, ['-c', `drop database if exists ${dbName} with (force)`])
})

test('a hold takes all its cells', { skip }, () => {
  const id = sql(reserve(520, 496, 2, 'a'))
  assert.match(id, /^\d+$/)
  assert.equal(sql(`select count(*) from cells where frame_id = ${id}`), '4')
})

test('an overlapping hold is refused', { skip }, () => {
  assert.match(sqlError(reserve(521, 497, 3, 'b')), /spot_taken/)
  assert.equal(sql(`select count(*) from frames where holder = 'b'`), '0')
})

test('one live hold per client', { skip }, () => {
  assert.match(sqlError(reserve(10, 10, 1, 'a')), /hold_exists/)
})

test('only a 1x1 frame can cover the heart', { skip }, () => {
  assert.match(sqlError(reserve(499, 499, 2, 'c')), /violates check constraint/)
  assert.match(sql(reserve(500, 500, 1, 'c')), /^\d+$/)
})

test('payment turns a hold into a frame, once', { skip }, () => {
  const id = sql(`select id from frames where holder = 'a'`)
  assert.equal(sql(`select activate_frame(${id}, 'pay_1')`), 't')
  assert.equal(sql(`select status from frames where id = ${id}`), 'active')
  assert.equal(sql(`select activate_frame(${id}, 'pay_1b')`), 'f')
  // The client can hold a new spot once the first one is paid.
  assert.match(sql(reserve(10, 10, 1, 'a')), /^\d+$/)
})

test('expired holds free their cells', { skip }, () => {
  sql(reserve(100, 100, 3, 'd', -10))
  assert.equal(sql('select expire_reservations()'), '1')
  assert.equal(sql('select count(*) from cells where x between 100 and 102 and y between 100 and 102'), '0')
  assert.match(sql(reserve(100, 100, 3, 'e')), /^\d+$/)
})

test('a released hold frees its cells at once', { skip }, () => {
  const id = sql(reserve(300, 300, 2, 'g'))
  assert.equal(sql(`select release_hold(${id})`), 't')
  assert.equal(sql(`select count(*) from cells where frame_id = ${id}`), '0')
  assert.equal(sql(`select release_hold(${id})`), 'f')
  assert.match(sql(reserve(300, 300, 2, 'g')), /^\d+$/)
})

test('a late payment for an expired hold is not activated', { skip }, () => {
  const id = sql(reserve(200, 200, 1, 'f', -10))
  sql('select expire_reservations()')
  assert.equal(sql(`select activate_frame(${id}, 'pay_late')`), 'f')
})
