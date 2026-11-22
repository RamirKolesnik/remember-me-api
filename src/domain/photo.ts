export const PHOTO_MAX_BYTES = 400_000

export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp'

export type ParsedPhoto =
  | { ok: true; mime: PhotoMime; data: Buffer }
  | { ok: false; error: 'bad_data_url' | 'unsupported_type' | 'too_large' | 'not_an_image' }

function sniff(data: Buffer): PhotoMime | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** Parses "data:image/...;base64,..." and checks that the bytes really are that image type. */
export function parsePhotoDataUrl(dataUrl: string): ParsedPhoto {
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return { ok: false, error: 'bad_data_url' }
  const declared = m[1]!
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(declared)) return { ok: false, error: 'unsupported_type' }
  const data = Buffer.from(m[2]!, 'base64')
  if (data.length > PHOTO_MAX_BYTES) return { ok: false, error: 'too_large' }
  const real = sniff(data)
  if (!real || real !== declared) return { ok: false, error: 'not_an_image' }
  return { ok: true, mime: real, data }
}
