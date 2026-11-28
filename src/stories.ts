// Story cards: rendered after a frame goes live, stored, and served from
// GET /frames/:id/story.jpg. A card that isn't ready yet is rendered on request.
//
// The queue is the database itself (paid frames without a card), so nothing is
// lost when the server restarts. It moves to BullMQ with Redis before launch.
import type pg from 'pg'
import { renderStory, STORY_MIME } from './domain/story.ts'
import { tagsOf } from './domain/wall.ts'
import { wallNow } from './milestones.ts'

export interface Stories {
  /** The card of an active frame, or null if there is no such frame. */
  get(id: number): Promise<{ mime: string; data: Buffer } | null>
  /** Render cards of newly paid frames in the background. */
  kick(): void
  /** Wait for the background run to finish (shutdown and tests). */
  idle(): Promise<void>
}

interface Logger {
  info(obj: object, msg: string): void
  error(obj: object, msg: string): void
}

interface StoryRow {
  id: string
  number: number | null
  x: number
  y: number
  size: number
  zone: number
  name: string
  photo: Buffer | null
}

/** "https://ramirkolesnik.github.io/remember-me-web/" → "ramirkolesnik.github.io/remember-me-web" */
export function siteLabelOf(frontendUrl: string): string {
  return frontendUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
}

export function createStories(opts: { db: pg.Pool; siteLabel: string; log: Logger; maxConcurrent?: number }): Stories {
  const { db, siteLabel, log } = opts
  const maxConcurrent = opts.maxConcurrent ?? 4
  const inflight = new Map<number, Promise<Buffer | null>>()
  let run: Promise<void> | null = null
  let again = false

  async function render(id: number): Promise<Buffer | null> {
    const { rows } = await db.query<StoryRow>(
      `select f.id, f.number, f.x, f.y, f.size, f.zone, f.name, p.data as photo
       from frames f left join photos p on p.id = f.photo_key
       where f.id = $1 and f.status = 'active'`, [id],
    )
    const r = rows[0]
    if (!r) return null
    // Fresh milestones, so the frame that was first in its zone or took the last spot gets its tag.
    const { milestones } = await wallNow(db)
    const tags = tagsOf({ number: r.number, x: r.x, y: r.y, size: r.size }, milestones)
    const data = await renderStory({
      tags,
      id: Number(r.id), number: r.number, x: r.x, y: r.y, size: r.size, zone: r.zone, name: r.name,
      photo: r.photo, siteLabel,
    })
    await db.query(
      'insert into frame_stories (frame_id, mime, data) values ($1, $2, $3) on conflict (frame_id) do nothing',
      [id, STORY_MIME, data],
    )
    return data
  }

  /** One render per frame at a time; callers asking for the same frame share it. */
  function renderOnce(id: number): Promise<Buffer | null> {
    let p = inflight.get(id)
    if (!p) {
      p = render(id).finally(() => inflight.delete(id))
      inflight.set(id, p)
    }
    return p
  }

  async function drain(): Promise<void> {
    do {
      again = false
      for (;;) {
        const { rows } = await db.query<{ id: string }>(
          `select f.id from frames f
           where f.status = 'active' and f.payment_ref is not null
             and not exists (select 1 from frame_stories s where s.frame_id = f.id)
           order by f.number limit 10`,
        )
        if (!rows.length) break
        for (const { id } of rows) {
          try {
            await renderOnce(Number(id))
            log.info({ frameId: Number(id) }, 'story card rendered')
          } catch (err) {
            // Leave it: the card is rendered on request instead.
            log.error({ err, frameId: Number(id) }, 'story card failed')
            return
          }
        }
      }
    } while (again)
  }

  return {
    async get(id) {
      const { rows } = await db.query<{ mime: string; data: Buffer; status: string }>(
        `select s.mime, s.data, f.status from frames f left join frame_stories s on s.frame_id = f.id where f.id = $1`, [id],
      )
      const r = rows[0]
      if (!r || r.status !== 'active') return null
      if (r.data) return { mime: r.mime, data: r.data }
      if (!inflight.has(id) && inflight.size >= maxConcurrent) throw new Error('story_busy')
      const data = await renderOnce(id)
      return data ? { mime: STORY_MIME, data } : null
    },
    kick() {
      if (run) {
        again = true
        return
      }
      run = drain()
        .catch((err) => log.error({ err }, 'story queue failed'))
        .finally(() => { run = null })
    },
    async idle() {
      while (run) await run
    },
  }
}
