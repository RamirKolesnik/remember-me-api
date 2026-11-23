// Demo frames for dev environments, so the wall isn't empty while testing.
import type pg from 'pg'
import { placementError, priceOf, WALL_SIZE, zoneOfFrame, type FrameSize } from '../domain/wall.ts'

export interface DemoFrame {
  x: number
  y: number
  size: FrameSize
  zone: number
  price: number
  name: string
  note: string
}

const FIRST = ['Aziza', 'Timur', 'Lena', 'Diego', 'Mei', 'Omar', 'Sofia', 'Ravi', 'Nodira', 'Jonas', 'Aiko', 'Malik', 'Elif', 'Kofi', 'Ana', 'Yusuf', 'Ingrid', 'Bekzod', 'Chloe', 'Arjun']
const LAST = ['K.', 'R.', 'M.', 'S.', 'T.', 'B.', 'A.', 'L.', 'N.', 'H.']
const NOTES = [
  'Was here before it was cool.', 'Hi mom!', 'Say hi on insta — @{h}', 'To whoever finds this: be kind today.',
  'First frame I ever bought. Not the last.', 'Remember us — {n} & friends.', 'Find me on X: @{h}', 'Ship it.',
  'Forever is a long time. Good.', 'Painter, runner, dad. @{h}',
]

/** Deterministic: the same frames every time. The heart stays free (placementError keeps frames off it). */
export function demoFrames(count = 1500): DemoFrame[] {
  let seed = 20261123
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const taken = new Uint8Array(WALL_SIZE * WALL_SIZE)
  const fits = (x: number, y: number, n: FrameSize) => {
    if (placementError(x, y, n)) return false
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (taken[(y + j) * WALL_SIZE + x + i]) return false
    return true
  }
  const out: DemoFrame[] = []
  const gauss = () => rnd() + rnd() + rnd() - 1.5
  for (let t = 0; t < count * 8 && out.length < count; t++) {
    const r = rnd()
    const n: FrameSize = r < 0.6 ? 1 : r < 0.9 ? 2 : 3
    const spread = rnd() < 0.85 ? 34 : 160
    const x = Math.round(WALL_SIZE / 2 + gauss() * spread)
    const y = Math.round(WALL_SIZE / 2 + gauss() * spread)
    if (!fits(x, y, n)) continue
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) taken[(y + j) * WALL_SIZE + x + i] = 1
    const first = FIRST[Math.floor(rnd() * FIRST.length)]!
    const handle = `${first.toLowerCase()}.${Math.floor(rnd() * 90 + 10)}`
    out.push({
      x, y, size: n,
      zone: zoneOfFrame(x, y, n).id,
      price: priceOf(x, y, n),
      name: `${first} ${LAST[Math.floor(rnd() * LAST.length)]!}`,
      note: NOTES[Math.floor(rnd() * NOTES.length)]!.replace('{h}', handle).replace('{n}', first),
    })
  }
  return out
}

/** Inserts demo frames when the wall has no frames at all. Returns how many were added. */
export async function seedDemoIfEmpty(db: pg.Pool): Promise<number> {
  const { rows } = await db.query<{ n: string }>('select count(*) as n from frames')
  if (Number(rows[0]?.n ?? 0) > 0) return 0
  const frames = demoFrames()
  const client = await db.connect()
  try {
    await client.query('begin')
    const ids = await client.query<{ id: string }>(
      `insert into frames (x, y, size, zone, price_usd, name, note, status, paid_at)
       select x, y, size, zone, price, name, note, 'active', now() - (random() * interval '60 days')
       from unnest($1::int[], $2::int[], $3::int[], $4::int[], $5::int[], $6::text[], $7::text[])
         as t(x, y, size, zone, price, name, note)
       returning id`,
      [frames.map((f) => f.x), frames.map((f) => f.y), frames.map((f) => f.size), frames.map((f) => f.zone),
        frames.map((f) => f.price), frames.map((f) => f.name), frames.map((f) => f.note)],
    )
    await client.query(
      `insert into cells (x, y, frame_id)
       select f.x + i, f.y + j, f.id from frames f,
         lateral generate_series(0, f.size - 1) i, lateral generate_series(0, f.size - 1) j
       where f.id = any($1::bigint[])`,
      [ids.rows.map((r) => r.id)],
    )
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
  return frames.length
}
