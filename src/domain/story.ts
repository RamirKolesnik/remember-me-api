// The 9:16 story card of a frame: a 1080×1920 JPEG for Instagram, TikTok and friends.
// Shapes are drawn as SVG; text is set by Pango with the bundled Inter font, so
// the card looks the same on every server, whatever fonts it has installed.
import sharp from 'sharp'
import { join } from 'node:path'
import { isFounder } from './wall.ts'

export const STORY_W = 1080
export const STORY_H = 1920
export const STORY_MIME = 'image/jpeg'

const FONT_DIR = join(import.meta.dirname, '..', '..', 'assets', 'fonts')
const REGULAR = join(FONT_DIR, 'Inter-Regular.otf')
const SEMIBOLD = join(FONT_DIR, 'Inter-SemiBold.otf')

/** Same swatches as the website, so a frame without a photo looks the same everywhere. */
const PALETTE: readonly [string, string][] = [
  ['#C9C3F0', '#3C3489'], ['#F4C0D1', '#72243E'], ['#9FE1CB', '#085041'],
  ['#FAC775', '#633806'], ['#B5D4F4', '#0C447C'], ['#F5C4B3', '#712B13'],
  ['#C0DD97', '#27500A'], ['#D3D1C7', '#444441'],
]

const ZONE_LABEL: Record<number, string> = { 1: 'Epic zone', 2: 'Rare zone', 3: 'Uncommon zone', 4: 'Common zone' }

export interface StoryFrame {
  id: number
  number: number | null
  x: number
  y: number
  size: number
  /** 0 is the heart. */
  zone: number
  name: string
  photo: Buffer | null
  /** Shown at the bottom of the card, e.g. "remember.me" or the site's host and path. */
  siteLabel: string
}

const escXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

export const initialsOf = (name: string) =>
  name.trim().split(/\s+/).map((w) => [...w][0] ?? '').join('').slice(0, 2).toUpperCase() || '?'

/** "I'm #4,812 on the wall.\nForever." */
export function storyCaption(f: Pick<StoryFrame, 'number' | 'zone'>): string {
  if (f.zone === 0) return 'I own the heart of the wall.\nForever.'
  if (f.number) return `I'm #${f.number.toLocaleString('en-US')} on the wall.\nForever.`
  return "I'm on the wall.\nForever."
}

export function storyMeta(f: Pick<StoryFrame, 'x' | 'y' | 'size' | 'zone' | 'number'>): string {
  if (f.zone === 0) return `The center of the wall · ${f.size}×${f.size} · one of one`
  const where = `Cell (${f.x}, ${f.y}) · ${ZONE_LABEL[f.zone] ?? `Zone ${f.zone}`}`
  return isFounder(f.number) ? `Founder · ${where}` : where
}

interface TextOpts {
  font: 'regular' | 'semibold'
  /** Point size at 72 dpi, which is pixels. */
  px: number
  color: string
  width: number
  letterSpacing?: number
}

/** One block of centred, word-wrapped text as a transparent PNG. */
async function text(content: string, o: TextOpts): Promise<{ png: Buffer; width: number; height: number }> {
  const spacing = o.letterSpacing ? ` letter_spacing="${Math.round(o.letterSpacing * 1024)}"` : ''
  const family = o.font === 'semibold' ? 'Inter SemiBold' : 'Inter'
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${o.color}"${spacing}>${escXml(content)}</span>`,
      font: `${family} ${o.px}`,
      fontfile: o.font === 'semibold' ? SEMIBOLD : REGULAR,
      width: o.width,
      align: 'centre',
      wrap: 'word-char',
      rgba: true,
      dpi: 72,
      spacing: Math.round(o.px * 0.18),
    },
  }).png().toBuffer({ resolveWithObject: true })
  return { png: data, width: info.width, height: info.height }
}

/** The largest size, down to `min`, at which the text fits in `maxLines` lines. */
async function fittedText(content: string, o: TextOpts & { min: number; maxLines: number }) {
  let px = o.px
  for (;;) {
    const t = await text(content, { ...o, px })
    const lines = Math.round(t.height / (px * 1.38))
    if (lines <= o.maxLines || px <= o.min) return t
    px = Math.max(o.min, Math.round(px * 0.86))
  }
}

async function avatar(f: StoryFrame, side: number, radius: number): Promise<Buffer> {
  const mask = Buffer.from(`<svg width="${side}" height="${side}"><rect width="${side}" height="${side}" rx="${radius}"/></svg>`)
  let square: Buffer
  if (f.photo) {
    try {
      square = await sharp(f.photo).rotate().resize(side, side, { fit: 'cover' }).toBuffer()
    } catch {
      square = await initialsSquare(f, side)
    }
  } else {
    square = await initialsSquare(f, side)
  }
  return sharp(square).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

async function initialsSquare(f: StoryFrame, side: number): Promise<Buffer> {
  const [bg, ink] = f.zone === 0 ? ['#FAECE7', '#D85A30'] : PALETTE[f.id % PALETTE.length]!
  const letters = await text(initialsOf(f.name), { font: 'semibold', px: Math.round(side * 0.36), color: ink, width: side })
  return sharp({ create: { width: side, height: side, channels: 4, background: bg } })
    .composite([{ input: letters.png, top: Math.round((side - letters.height) / 2), left: Math.round((side - letters.width) / 2) }])
    .png().toBuffer()
}

interface Theme {
  ground: string
  grid: string
  ink: string
  muted: string
  accent: string
  pillFill: string
  pillLine: string
  frameFill: string
  glow: string | null
}

const LIGHT: Theme = {
  ground: '#F6F5F1', grid: '#E9E7DF', ink: '#18171C', muted: '#5F5E5A', accent: '#534AB7',
  pillFill: '#FFFFFF', pillLine: '#E4E2DA', frameFill: '#FFFFFF', glow: null,
}
const HEART: Theme = {
  ground: '#18171C', grid: '#232228', ink: '#FFFFFF', muted: '#B4B2A9', accent: '#F0997B',
  pillFill: '#24232A', pillLine: '#3A3940', frameFill: '#D85A30', glow: '#D85A30',
}

/** Renders the story card. Pure: same input, same picture. */
export async function renderStory(f: StoryFrame): Promise<Buffer> {
  const heart = f.zone === 0
  const t = heart ? HEART : LIGHT
  const W = STORY_W, H = STORY_H
  const border = 24, radius = 40, ay = 420

  // Instagram covers ~250 px at the top and bottom with its own UI: everything
  // that matters sits between y = 230 and y = 1680.
  const [brand, kicker, name, caption, meta, site] = await Promise.all([
    text('remember.me', { font: 'semibold', px: 46, color: t.ink, width: 900, letterSpacing: -0.5 }),
    text(heart ? 'THE HEART OF THE WALL' : 'A WALL THAT REMEMBERS', { font: 'semibold', px: 28, color: t.accent, width: 900, letterSpacing: 4 }),
    fittedText(f.name, { font: 'semibold', px: 92, min: 56, maxLines: 2, color: t.ink, width: 920, letterSpacing: -1 }),
    text(storyCaption(f), { font: 'regular', px: 56, color: t.ink, width: 960 }),
    text(storyMeta(f), { font: 'regular', px: 32, color: t.muted, width: 900 }),
    text(`Claim your spot · ${f.siteLabel}`, { font: 'regular', px: 30, color: t.muted, width: 940 }),
  ])

  // The photo shrinks when a long name needs a second line.
  const pillH = meta.height + 36, pillW = meta.width + 64
  const below = border + 64 + name.height + 40 + caption.height + 48 + pillH
  const side = Math.min(640, 1580 - ay - border - below)
  const ax = Math.round((W - side) / 2)
  const nameY = ay + side + border + 64
  const captionY = nameY + name.height + 40
  const pillY = captionY + caption.height + 48
  const face = await avatar(f, side, radius)

  const glow = t.glow
    ? `<radialGradient id="g" cx="50%" cy="${(ay + side / 2) / H * 100}%" r="60%"><stop offset="0" stop-color="${t.glow}" stop-opacity=".45"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>`
    : ''
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <pattern id="cells" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="${t.grid}" stroke-width="2"/>
    </pattern>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="32" flood-color="#18171C" flood-opacity="${heart ? 0.6 : 0.16}"/>
    </filter>
    ${glow}
  </defs>
  <rect width="${W}" height="${H}" fill="${t.ground}"/>
  <rect width="${W}" height="${H}" fill="url(#cells)"/>
  ${glow ? `<rect width="${W}" height="${H}" fill="url(#g)"/>` : ''}
  <rect x="${ax - border}" y="${ay - border}" width="${side + border * 2}" height="${side + border * 2}" rx="${radius + border}"
        fill="${t.frameFill}" filter="url(#shadow)"/>
  <rect x="${(W - pillW) / 2}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}"
        fill="${t.pillFill}" stroke="${t.pillLine}" stroke-width="2"/>
</svg>`)

  const centred = (img: { png: Buffer; width: number }, top: number) =>
    ({ input: img.png, top: Math.round(top), left: Math.round((W - img.width) / 2) })

  return sharp(bg)
    .composite([
      centred(brand, 236),
      centred(kicker, 306),
      { input: face, top: ay, left: ax },
      centred(name, nameY),
      centred(caption, captionY),
      centred(meta, pillY + 18),
      centred(site, 1640),
    ])
    .flatten({ background: t.ground })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
}
