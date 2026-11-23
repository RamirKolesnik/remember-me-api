import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { renderStory, storyCaption, storyMeta, STORY_H, STORY_W, initialsOf } from '../src/domain/story.ts'
import { siteLabelOf } from '../src/stories.ts'

const base = { id: 7, number: 4812, x: 512, y: 488, size: 2, zone: 1, name: 'Aziza K.', photo: null, siteLabel: 'remember.me' }

test('caption carries the frame number', () => {
  assert.equal(storyCaption(base), "I'm #4,812 on the wall.\nForever.")
  assert.equal(storyCaption({ number: null, zone: 2 }), "I'm on the wall.\nForever.")
  assert.equal(storyCaption({ number: 1, zone: 0 }), 'I own the heart of the wall.\nForever.')
})

test('meta line names the cell and zone', () => {
  assert.equal(storyMeta(base), 'Cell (512, 488) · Zone 1 · center · 2×2')
  assert.equal(storyMeta({ x: 498, y: 498, size: 4, zone: 0 }), 'The center of the wall · 4×4 · one of one')
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
  for (const f of [base, { ...base, photo }, { ...base, zone: 0, x: 498, y: 498, size: 4 }]) {
    const img = await renderStory(f)
    const meta = await sharp(img).metadata()
    assert.equal(meta.format, 'jpeg')
    assert.equal(meta.width, STORY_W)
    assert.equal(meta.height, STORY_H)
  }
})

test('the heart has its own template', async () => {
  const mean = async (buf: Buffer) => (await sharp(buf).stats()).channels[1]!.mean
  const plain = await mean(await renderStory(base))
  const heart = await mean(await renderStory({ ...base, zone: 0, x: 498, y: 498, size: 4 }))
  assert.ok(plain > 180, `light card, mean green ${plain}`)
  assert.ok(heart < 80, `dark card, mean green ${heart}`)
})

test('a broken photo falls back to initials, and long names still fit', async () => {
  const img = await renderStory({
    ...base, photo: Buffer.from('not an image'),
    name: 'Bartholomew Maximilian von Wolkenstein-II', number: 999_999,
  })
  assert.equal((await sharp(img).metadata()).height, STORY_H)
})
