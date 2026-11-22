import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePhotoDataUrl, PHOTO_MAX_BYTES } from '../src/domain/photo.ts'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46])
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const url = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString('base64')}`

test('accepts real jpeg and png', () => {
  const a = parsePhotoDataUrl(url('image/jpeg', jpeg))
  assert.equal(a.ok && a.mime, 'image/jpeg')
  const b = parsePhotoDataUrl(url('image/png', png))
  assert.equal(b.ok && b.mime, 'image/png')
})

test('rejects lies, junk and big files', () => {
  assert.deepEqual(parsePhotoDataUrl(url('image/png', jpeg)), { ok: false, error: 'not_an_image' })
  assert.deepEqual(parsePhotoDataUrl(url('image/gif', jpeg)), { ok: false, error: 'unsupported_type' })
  assert.deepEqual(parsePhotoDataUrl('hello'), { ok: false, error: 'bad_data_url' })
  assert.deepEqual(parsePhotoDataUrl(url('image/jpeg', Buffer.from('<svg/>'))), { ok: false, error: 'not_an_image' })
  const big = Buffer.concat([jpeg, Buffer.alloc(PHOTO_MAX_BYTES)])
  assert.deepEqual(parsePhotoDataUrl(url('image/jpeg', big)), { ok: false, error: 'too_large' })
})
