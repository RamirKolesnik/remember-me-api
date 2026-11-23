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

test('no hold can touch the heart', { skip }, () => {
  assert.match(sqlError(reserve(500, 500, 1, 'c')), /frames_off_heart/)
  assert.match(sqlError(reserve(496, 496, 3, 'c')), /frames_off_heart/)
  assert.match(sql(reserve(495, 495, 3, 'c')), /^\d+$/)
})

test('the heart is placed once, by hand', { skip }, () => {
  assert.match(sql(`select place_heart('Owner', 'hi', null, 12000, 'deal-1')`), /^\d+$/)
  assert.equal(sql(`select count(*) from cells c join frames f on f.id = c.frame_id where f.zone = 0`), '16')
  assert.equal(sql(`select number is not null from frames where zone = 0`), 't')
  assert.match(sqlError(`select place_heart('Other', '', null, 10000, 'deal-2')`), /heart_sold/)
  // Zone 0 is only ever the 4x4 heart.
  assert.match(sqlError(`insert into frames (x, y, size, zone, price_usd, name, status) values (10, 10, 1, 0, 1, 'x', 'active')`), /frames_heart/)
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

test('frames get numbers in the order they go live', { skip }, () => {
  const a = sql(reserve(600, 600, 1, 'n1'))
  const b = sql(reserve(602, 600, 1, 'n2'))
  assert.equal(sql(`select number from frames where id = ${a}`), '', 'a hold has no number')
  sql(`select activate_frame(${b}, 'pay_n2')`)
  sql(`select activate_frame(${a}, 'pay_n1')`)
  const nb = Number(sql(`select number from frames where id = ${b}`))
  const na = Number(sql(`select number from frames where id = ${a}`))
  assert.ok(nb > 0)
  assert.equal(na, nb + 1)
  // Hiding and showing a frame keeps its number.
  sql(`update frames set status = 'hidden' where id = ${a}`)
  sql(`update frames set status = 'active' where id = ${a}`)
  assert.equal(Number(sql(`select number from frames where id = ${a}`)), na)
})

// psql prints the command tag after the returned row: keep the first line only.
const insertActive = (x: number, y: number, name: string) => sql(
  `insert into frames (x, y, size, zone, price_usd, name, status, paid_at)
   values (${x}, ${y}, 1, 3, 6, '${name}', 'active', now()) returning id`,
).split('\n')[0]!

test('frames inserted as active (seed) get numbers too', { skip }, () => {
  const id = insertActive(700, 700, 'Seed')
  assert.match(sql(`select number from frames where id = ${id}`), /^\d+$/)
  assert.equal(sql(`select count(*) from frames where status = 'active' and number is null`), '0')
  assert.equal(sql(`select count(*) - count(distinct number) from frames where number is not null`), '0')
})

test('a story card goes away with its frame', { skip }, () => {
  const id = insertActive(710, 710, 'Gone')
  sql(`insert into frame_stories (frame_id, mime, data) values (${id}, 'image/jpeg', '\\xffd8ff')`)
  sql(`delete from frames where id = ${id}`)
  assert.equal(sql(`select count(*) from frame_stories where frame_id = ${id}`), '0')
})
