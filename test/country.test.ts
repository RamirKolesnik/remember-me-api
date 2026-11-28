import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countryCode, rankCountries } from '../src/domain/country.ts'
import { countryOf } from '../src/geo.ts'

test('country codes are cleaned', () => {
  assert.equal(countryCode('us'), 'US')
  assert.equal(countryCode(' UZ '), 'UZ')
  for (const bad of ['XX', 'T1', 'A1', 'EU', 'USA', '', 'U', null, undefined, 42]) assert.equal(countryCode(bad), null)
})

test('countries are ranked by frames, unknown kept apart', () => {
  const r = rankCountries([
    { country: 'DE', n: 3 }, { country: 'US', n: 5 }, { country: null, n: 2 }, { country: 'BR', n: 3 }, { country: 'XX', n: 1 },
  ])
  assert.equal(r.total, 14)
  assert.equal(r.unknown, 3)
  assert.deepEqual(r.countries, [{ code: 'US', count: 5 }, { code: 'BR', count: 3 }, { code: 'DE', count: 3 }])
})

test('a CDN country header wins', async () => {
  assert.equal(await countryOf({ 'cf-ipcountry': 'uz' }, '8.8.8.8'), 'UZ')
})

test('private and bad IPs have no country', async () => {
  assert.equal(await countryOf({}, '127.0.0.1'), null)
  assert.equal(await countryOf({}, '10.0.0.1'), null)
  assert.equal(await countryOf({}, 'nope'), null)
  assert.equal(await countryOf({}, '::ffff:192.168.1.5'), null)
  assert.equal(await countryOf({}, '::1'), null)
})

test('a public IP is found in the offline data', { skip: process.env.CI ? false : 'GeoIP data is checked in CI' }, async () => {
  assert.equal(await countryOf({}, '8.8.8.8'), 'US')
})
