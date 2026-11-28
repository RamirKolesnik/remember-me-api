// The 9:16 story card of a frame: a 1080×1920 JPEG for Instagram, TikTok and friends.
// Shapes are drawn as SVG; text is set by Pango with the bundled Inter font, so
// the card looks the same on every server, whatever fonts it has installed.
import sharp, { type OverlayOptions } from 'sharp'
import { join } from 'node:path'
import type { Tag, TagId } from './wall.ts'

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

// The rings of the living wall, from the heart out, in the same colours as on the site (tiers.ts).
const ZONE_LABEL: Record<number, string> = { 1: 'Chambers', 2: 'Arteries', 3: 'Veins', 4: 'Capillaries' }
export const ZONE_COLOR: Record<number, string> = { 0: '#FF3B52', 1: '#FF4D8D', 2: '#FF5A4E', 3: '#6F7CFF', 4: '#C7A4B3' }
/** Tag colours, as on the site (app/shared/tags.ts). */
export const TAG_COLOR: Record<TagId, string> = {
  'founder': '#FF3B52', 'first-wave': '#5ED3C4', 'first-in-zone': '#8BDB96',
  'last-spot': '#FF9F43', 'lucky': '#FFD27A', 'heart-neighbour': '#FF8FA2',
}

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
  /** Founder, lucky number and friends (tagsOf in wall.ts), shown as pills after the zone. */
  tags?: readonly Tag[]
}

const escXml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

export const initialsOf = (name: string) =>
  name.trim().split(/\s+/).map((w) => [...w][0] ?? '').join('').slice(0, 2).toUpperCase() || '?'

/** "I'm heartbeat #4,812.\nForever." */
export function storyCaption(f: Pick<StoryFrame, 'number' | 'zone'>): string {
  if (f.zone === 0) return 'I own the heart of the wall.\nForever.'
  if (f.number) return `I'm heartbeat #${f.number.toLocaleString('en-US')}.\nForever.`
  return "I'm on the wall.\nForever."
}

/** The grey pill under the tags: where the frame is. */
export function storyMeta(f: Pick<StoryFrame, 'x' | 'y' | 'size' | 'zone'>): string {
  if (f.zone === 0) return `The center of the wall · ${f.size}×${f.size} · one of one`
  return `Cell (${f.x}, ${f.y})`
}

/** The coloured pills: the zone first, then the frame's tags. */
export function storyTags(f: Pick<StoryFrame, 'zone' | 'tags'>): { label: string; color: string }[] {
  const pills = f.zone === 0 ? [] : [{ label: ZONE_LABEL[f.zone] ?? `Zone ${f.zone}`, color: ZONE_COLOR[f.zone] ?? '#C7A4B3' }]
  for (const t of f.tags ?? []) pills.push({ label: t.label, color: TAG_COLOR[t.id] })
  return pills
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

// The Living Wall: a dark body with red blood in the seams. The heart's own
// card glows red around the owner's photo.
const LIGHT: Theme = {
  ground: '#0B0709', grid: '#2A1218', ink: '#F6ECEE', muted: '#A3919A', accent: '#FF5C77',
  pillFill: '#1A1014', pillLine: '#3A2229', frameFill: '#FFFFFF', glow: null,
}
const HEART: Theme = {
  ground: '#0B0709', grid: '#3A121C', ink: '#FFFFFF', muted: '#C9AFB7', accent: '#FF8FA2',
  pillFill: '#22121A', pillLine: '#5A1F2C', frameFill: '#FF3B52', glow: '#FF3B52',
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
    text('The Living Wall', { font: 'semibold', px: 46, color: t.ink, width: 900, letterSpacing: -0.5 }),
    text(heart ? 'THE HEART OF THE WALL' : 'EVERY FACE IS A HEARTBEAT', { font: 'semibold', px: 28, color: heart ? t.accent : (ZONE_COLOR[f.zone] ?? t.accent), width: 900, letterSpacing: 4 }),
    fittedText(f.name, { font: 'semibold', px: 92, min: 56, maxLines: 2, color: t.ink, width: 920, letterSpacing: -1 }),
    text(storyCaption(f), { font: 'regular', px: 56, color: t.ink, width: 960 }),
    text(storyMeta(f), { font: 'regular', px: 32, color: t.muted, width: 900 }),
    text(`Claim your spot · ${f.siteLabel}`, { font: 'regular', px: 30, color: t.muted, width: 940 }),
  ])

  // Tag pills, wrapped into centred rows.
  const tagTexts = await Promise.all(storyTags(f).map(async (p) =>
    ({ ...p, img: await text(p.label, { font: 'semibold', px: 30, color: p.color, width: 900 }) })))
  const TAG_PAD = 28, TAG_GAP = 16, TAG_MAX_W = 960
  const tagH = tagTexts.length ? Math.max(...tagTexts.map((t) => t.img.height)) + 24 : 0
  const rows: (typeof tagTexts)[] = []
  for (const t of tagTexts) {
    const row = rows[rows.length - 1]
    const w = (r: typeof tagTexts) => r.reduce((s, x) => s + x.img.width + TAG_PAD * 2, 0) + TAG_GAP * (r.length - 1)
    if (row && w([...row, t]) <= TAG_MAX_W) row.push(t)
    else rows.push([t])
  }
  const tagsBlock = rows.length ? rows.length * tagH + (rows.length - 1) * TAG_GAP + 28 : 0

  // The photo shrinks when a long name needs a second line or the tags two rows.
  const pillH = meta.height + 36, pillW = meta.width + 64
  const below = border + 64 + name.height + 40 + caption.height + 48 + tagsBlock + pillH
  const side = Math.min(640, 1580 - ay - border - below)
  const ax = Math.round((W - side) / 2)
  const nameY = ay + side + border + 64
  const captionY = nameY + name.height + 40
  const tagsY = captionY + caption.height + 48
  const pillY = tagsY + tagsBlock
  const tagShapes: string[] = []
  const tagImages: OverlayOptions[] = []
  rows.forEach((row, i) => {
    const rowW = row.reduce((s, x) => s + x.img.width + TAG_PAD * 2, 0) + TAG_GAP * (row.length - 1)
    let x = (W - rowW) / 2
    const y = tagsY + i * (tagH + TAG_GAP)
    for (const t of row) {
      const w = t.img.width + TAG_PAD * 2
      tagShapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${tagH}" rx="${tagH / 2}" fill="${t.color}" fill-opacity=".16" stroke="${t.color}" stroke-opacity=".55" stroke-width="2"/>`)
      tagImages.push({ input: t.img.png, top: Math.round(y + (tagH - t.img.height) / 2), left: Math.round(x + TAG_PAD) })
      x += w + TAG_GAP
    }
  })
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
  ${tagShapes.join('\n  ')}
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
      ...tagImages,
      centred(meta, pillY + 18),
      centred(site, 1640),
    ])
    .flatten({ background: t.ground })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()
}
