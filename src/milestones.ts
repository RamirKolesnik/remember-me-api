// What the wall has sold, zone by zone, and its milestones: the first frame of
// each zone, the frame that sold a zone out, and the frame that opened wave 2.
// The same rules as milestonesOf() in wall.ts, worked out in SQL.
import {
  NO_MILESTONES, NOTHING_SOLD, WAVE_UNLOCK_SHARE, ZONES, type Milestones, type Sold, type ZoneId,
} from './domain/wall.ts'

const WAVE1 = ZONES.filter((z) => z.wave === 1)
const WAVE1_UNLOCK_AT = Math.ceil(WAVE1.reduce((s, z) => s + z.capacity, 0) * WAVE_UNLOCK_SHARE)

/** Anything that runs a query: a pg pool or client (and a psql stand-in in the tests). */
export interface Queryable {
  query<R>(text: string, values?: unknown[]): Promise<{ rows: R[] }>
}

export interface WallNow {
  sold: Sold
  milestones: Milestones
}

/** Frames are forever (hidden ones keep their cells), so all of this only grows. */
export async function wallNow(db: Queryable): Promise<WallNow> {
  const { rows } = await db.query<{ zone: number; n: string; first: number | null; last: number | null }>(
    `select zone, count(*) as n, min(number) as first, max(number) as last from frames
     where status in ('active', 'hidden') and zone between 1 and 4 group by zone`,
  )
  const sold: Record<ZoneId, number> = { ...NOTHING_SOLD }
  const zones = structuredClone(NO_MILESTONES.zones)
  for (const r of rows) {
    const id = r.zone as ZoneId
    const n = Number(r.n)
    sold[id] = n
    zones[id].first = r.first
    // Numbers follow the order frames went live, so a full zone's highest number sold it out.
    if (n >= ZONES[id - 1]!.capacity) zones[id].last = r.last
  }
  let firstWaveLast: number | null = null
  if (WAVE1.reduce((s, z) => s + sold[z.id], 0) >= WAVE1_UNLOCK_AT) {
    const r = await db.query<{ number: number }>(
      `select number from frames
       where status in ('active', 'hidden') and zone = any($1::int[]) and number is not null
       order by number offset $2 limit 1`,
      [WAVE1.map((z) => z.id), WAVE1_UNLOCK_AT - 1],
    )
    firstWaveLast = r.rows[0]?.number ?? null
  }
  return { sold, milestones: { firstWaveLast, zones } }
}
