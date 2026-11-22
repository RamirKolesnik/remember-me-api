import { test } from 'node:test'
import assert from 'node:assert/strict'
import { demoFrames } from '../src/db/seed.ts'
import { HEART, placementError, WALL_SIZE } from '../src/domain/wall.ts'

test('demo frames follow the wall rules and never overlap', () => {
  const frames = demoFrames()
  assert.ok(frames.length > 1000)
  const taken = new Set<number>()
  for (const f of frames) {
    assert.equal(placementError(f.x, f.y, f.size), null)
    for (let i = 0; i < f.size; i++) for (let j = 0; j < f.size; j++) {
      const k = (f.y + j) * WALL_SIZE + f.x + i
      assert.ok(!taken.has(k), `overlap at ${f.x + i},${f.y + j}`)
      taken.add(k)
    }
  }
  assert.ok(!taken.has(HEART.y * WALL_SIZE + HEART.x), 'the heart stays free')
  assert.deepEqual(demoFrames(), frames, 'deterministic')
})
