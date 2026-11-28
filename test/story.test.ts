import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { renderStory, storyCaption, storyMeta, storyTags, STORY_H, STORY_W, initialsOf, ZONE_COLOR } from '../src/domain/story.ts'
import { tagsOf } from '../src/domain/wall.ts'
import { siteLabelOf } from '../src/stories.ts'

const base = { id: 7, number: 4812, x: 512, y: 488, size: 2, zone: 1, name: 'Aziza K.', photo: null, siteLabel: 'remember.me' }

test('caption carries the frame number', () => {
  assert.equal(storyCaption(base), "I'm heartbeat #4,812.\nForever.")
  assert.equal(storyCaption({ number: null, zone: 2 }), "I'm on the wall.\nForever.")
  assert.equal(storyCaption({ number: 1, zone: 0 }), 'I own the heart of the wall.\nForever.')
})

test('meta line names the cell', () => {
  assert.equal(storyMeta(base), 'Cell (512, 488)')
  assert.equal(storyMeta({ x: 495, y: 495, size: 12, zone: 0 }), 'The center of the wall · 12×12 · one of one')
})

test('tag pills: the zone in its colour, then the tags', () => {
  assert.deepEqual(storyTags(base), [{ label: 'Chambers', color: ZONE_COLOR[1] }])
  const tags = tagsOf({ number: 777, x: 494, y: 500, size: 1 }, null)
  assert.deepEqual(storyTags({ zone: 1, tags }).map((p) => p.label), ['Chambers', 'Founder', 'Lucky number', 'Heart neighbour'])
  assert.deepEqual(storyTags({ zone: 0, tags: [] }), [])
})

test('initials', () => {
  assert.equal(initialsOf('aziza karimova'), 'AK')
  assert.equal(initialsOf('Тимур'), 'Т')
  assert.equal(initialsOf('  '), '?')
})

test('site label drops the scheme and trailing slash', () => {
  assert.equal(siteLabelOf('https://ramirkolesnik.github.io/remember-me-web/'), 'ramirkolesnik.github.io/remember-me-web')
  assert.equal(siteLabelOf('https://www.remember.me'), 'remember.me')
})

test('renders a 1080×1920 JPEG, with and without a photo', async () => {
  const photo = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#7a9' } }).jpeg().toBuffer()
  for (const f of [base, { ...base, photo }, { ...base, zone: 0, x: 495, y: 495, size: 12 }]) {
    const img = await renderStory(f)
    const meta = await sharp(img).metadata()
    assert.equal(meta.format, 'jpeg')
    assert.equal(meta.width, STORY_W)
    assert.equal(meta.height, STORY_H)
  }
})

test('the heart has its own template', async () => {
  const means = async (buf: Buffer) => (await sharp(buf).stats()).channels.map((c) => c.mean)
  const [plainRed, plainGreen] = await means(await renderStory(base))
  const [heartRed] = await means(await renderStory({ ...base, zone: 0, x: 495, y: 495, size: 12 }))
  // Both cards are the dark living wall; the heart's glows red.
  assert.ok(plainGreen! < 80, `dark card, mean green ${plainGreen}`)
  assert.ok(heartRed! > plainRed! + 3, `the heart glows red: ${heartRed} vs ${plainRed}`)
})

test('a broken photo falls back to initials, and long names still fit', async () => {
  const img = await renderStory({
    ...base, photo: Buffer.from('not an image'),
    name: 'Bartholomew Maximilian von Wolkenstein-II', number: 999_999,
  })
  assert.equal((await sharp(img).metadata()).height, STORY_H)
})

test('a long name and every tag still fit', async () => {
  const tags = [...tagsOf({ number: 1, x: 494, y: 500, size: 1 }, {
    firstWaveLast: null,
    zones: { 1: { first: 1, last: 1 }, 2: { first: null, last: null }, 3: { first: null, last: null }, 4: { first: null, last: null } },
  })]
  assert.equal(tags.length, 6)
  const img = await renderStory({ ...base, tags, name: 'Bartholomew Maximilian von Wolkenstein-II' })
  assert.equal((await sharp(img).metadata()).height, STORY_H)
})
