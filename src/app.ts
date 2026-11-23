import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { randomBytes } from 'node:crypto'
import type pg from 'pg'
import type { Config } from './config.ts'
import type { CaptchaVerifier } from './adapters/captcha.ts'
import type { PaymentProvider } from './adapters/payments.ts'
import type { Moderator } from './adapters/moderation.ts'
import { sandboxRoutes } from './routes/sandbox.ts'
import type { Stories } from './stories.ts'
import { parsePhotoDataUrl } from './domain/photo.ts'
import {
  containsLink, NAME_MAX, NOTE_MAX, placementError, priceOf, WALL_SIZE, zoneOfFrame,
  type FrameSize,
} from './domain/wall.ts'

export interface Deps {
  config: Config
  db: pg.Pool
  captcha: CaptchaVerifier
  payments: PaymentProvider
  moderator: Moderator
  stories: Stories
}

interface FrameRow {
  id: string
  number: number | null
  x: number
  y: number
  size: number
  zone: number
  name: string
  note: string
  photo_key: string | null
  paid_at: Date | null
}

const FRAME_COLUMNS = 'id, number, x, y, size, zone, name, note, photo_key, paid_at'
const MAX_VIEW_CELLS = 250_000 // a 500x500 window at most per request

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const { config, db, captcha, payments, moderator, stories } = deps
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 64 * 1024 })
  await app.register(cors, { origin: config.corsOrigins })

  const toFrame = (r: FrameRow) => ({
    id: Number(r.id), number: r.number, x: r.x, y: r.y, size: r.size, zone: r.zone,
    name: r.name, note: r.note,
    photoUrl: r.photo_key ? `${config.publicUrl}/photos/${r.photo_key}` : null,
    placedAt: r.paid_at,
  })

  app.get('/health', async () => {
    await db.query('select 1')
    return { ok: true, payments: payments.name, moderation: moderator.name }
  })

  app.get('/wall/stats', async () => {
    const { rows } = await db.query<{ frames: string; cells: string }>(
      `select count(*) as frames, coalesce(sum(size * size), 0) as cells from frames where status = 'active'`,
    )
    const frames = Number(rows[0]?.frames ?? 0), cells = Number(rows[0]?.cells ?? 0)
    return { frames, cellsTaken: cells, cellsLeft: WALL_SIZE * WALL_SIZE - cells }
  })

  app.get<{ Querystring: { x0: number; y0: number; x1: number; y1: number } }>('/wall/frames', {
    schema: {
      querystring: {
        type: 'object',
        required: ['x0', 'y0', 'x1', 'y1'],
        properties: {
          x0: { type: 'integer', minimum: 0, maximum: 999 },
          y0: { type: 'integer', minimum: 0, maximum: 999 },
          x1: { type: 'integer', minimum: 0, maximum: 999 },
          y1: { type: 'integer', minimum: 0, maximum: 999 },
        },
      },
    },
  }, async (req, reply) => {
    const { x0, y0, x1, y1 } = req.query
    if (x1 < x0 || y1 < y0) return reply.code(400).send({ error: 'bad_window' })
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_VIEW_CELLS) return reply.code(400).send({ error: 'window_too_large' })
    const { rows } = await db.query<FrameRow>(
      `select ${FRAME_COLUMNS} from frames
       where status = 'active' and x <= $3 and x + size - 1 >= $1 and y <= $4 and y + size - 1 >= $2`,
      [x0, y0, x1, y1],
    )
    return { frames: rows.map(toFrame) }
  })

  /** Cells that are on hold right now, so the spot picker can show them as taken. */
  app.get('/wall/holds', async () => {
    const { rows } = await db.query<{ x: number; y: number; size: number }>(
      `select x, y, size from frames where status = 'reserved'`,
    )
    return { holds: rows }
  })

  const idParams = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } }

  app.get<{ Params: { id: number } }>('/frames/:id', { schema: { params: idParams } }, async (req, reply) => {
    const { rows } = await db.query<FrameRow>(
      `select ${FRAME_COLUMNS} from frames where id = $1 and status = 'active'`, [req.params.id],
    )
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' })
    return { ...toFrame(rows[0]), storyUrl: `${config.publicUrl}/frames/${rows[0].id}/story.jpg` }
  })

  // The 9:16 story card. Frames never change, so the picture can be cached for good.
  app.get<{ Params: { id: number } }>('/frames/:id/story.jpg', { schema: { params: idParams } }, async (req, reply) => {
    let story
    try {
      story = await stories.get(req.params.id)
    } catch (err) {
      if ((err as Error).message === 'story_busy') {
        return reply.code(503).header('retry-after', '2').send({ error: 'busy' })
      }
      throw err
    }
    if (!story) return reply.code(404).send({ error: 'not_found' })
    // Short public cache: an admin may still hide the frame.
    reply.header('cache-control', 'public, max-age=3600')
    reply.header('x-content-type-options', 'nosniff')
    reply.header('content-disposition', `inline; filename="remember-me-${req.params.id}.jpg"`)
    return reply.type(story.mime).send(story.data)
  })

  const sizeSchema = { type: 'integer', enum: [1, 2, 3] }
  const cellSchema = { type: 'integer', minimum: 0, maximum: 999 }

  app.get<{ Querystring: { x: number; y: number; size: FrameSize } }>('/price', {
    schema: {
      querystring: {
        type: 'object',
        required: ['x', 'y', 'size'],
        properties: { x: cellSchema, y: cellSchema, size: sizeSchema },
      },
    },
  }, async (req) => {
    const { x, y, size } = req.query
    const error = placementError(x, y, size)
    if (error) return { error }
    return { priceUsd: priceOf(x, y, size), zone: zoneOfFrame(x, y, size).id }
  })

  // Photos: a base64 data URL in JSON, at most ~400 KB of image. The website
  // resizes photos to 512 px before upload.
  app.post<{ Body: { dataUrl: string } }>('/photos', {
    bodyLimit: 600 * 1024,
    schema: {
      body: {
        type: 'object',
        required: ['dataUrl'],
        additionalProperties: false,
        properties: { dataUrl: { type: 'string', maxLength: 560_000 } },
      },
    },
  }, async (req, reply) => {
    const parsed = parsePhotoDataUrl(req.body.dataUrl)
    if (!parsed.ok) return reply.code(422).send({ error: parsed.error })
    const verdict = await moderator.checkImage(parsed.mime, parsed.data)
    if (!verdict.approved) return reply.code(422).send({ error: 'rejected_by_moderation', reason: verdict.reason })
    const key = randomBytes(12).toString('base64url')
    await db.query('insert into photos (id, mime, data) values ($1, $2, $3)', [key, parsed.mime, parsed.data])
    return reply.code(201).send({ photoKey: key, url: `${config.publicUrl}/photos/${key}` })
  })

  app.get<{ Params: { key: string } }>('/photos/:key', {
    schema: { params: { type: 'object', properties: { key: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,40}$' } } } },
  }, async (req, reply) => {
    const { rows } = await db.query<{ mime: string; data: Buffer }>('select mime, data from photos where id = $1', [req.params.key])
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' })
    reply.header('cache-control', 'public, max-age=31536000, immutable')
    reply.header('x-content-type-options', 'nosniff')
    return reply.type(rows[0].mime).send(rows[0].data)
  })

  interface ReserveBody {
    x: number; y: number; size: FrameSize
    name: string; note?: string; photoKey?: string; captchaToken?: string
  }

  app.post<{ Body: ReserveBody }>('/reservations', {
    schema: {
      body: {
        type: 'object',
        required: ['x', 'y', 'size', 'name'],
        additionalProperties: false,
        properties: {
          x: cellSchema, y: cellSchema, size: sizeSchema,
          name: { type: 'string', minLength: 1, maxLength: NAME_MAX },
          note: { type: 'string', maxLength: NOTE_MAX },
          photoKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,40}$' },
          captchaToken: { type: 'string', maxLength: 4096 },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body
    const name = b.name.trim()
    const note = (b.note ?? '').trim()
    const placement = placementError(b.x, b.y, b.size)
    if (placement) return reply.code(422).send({ error: placement })
    if (!name) return reply.code(422).send({ error: 'name_required' })
    if (containsLink(name) || containsLink(note)) return reply.code(422).send({ error: 'links_not_allowed' })
    if (b.photoKey) {
      const { rowCount } = await db.query('select 1 from photos where id = $1', [b.photoKey])
      if (!rowCount) return reply.code(422).send({ error: 'unknown_photo' })
    }
    if (!(await captcha.verify(b.captchaToken, req.ip))) return reply.code(403).send({ error: 'captcha_failed' })
    if (!payments.configured) return reply.code(503).send({ error: 'payments_unavailable' })

    // The heart is never sold here: placementError refuses any spot on it.
    const zone = zoneOfFrame(b.x, b.y, b.size).id
    const price = priceOf(b.x, b.y, b.size)

    let id: string
    try {
      const { rows } = await db.query<{ id: string }>(
        'select reserve_frame($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as id',
        [b.x, b.y, b.size, zone, price, name, note, b.photoKey ?? null, req.ip, config.reservationMinutes],
      )
      id = rows[0]!.id
    } catch (err) {
      const e = err as { code?: string; message?: string }
      if (e.code === 'P0001' && e.message === 'spot_taken') return reply.code(409).send({ error: 'spot_taken' })
      if (e.code === 'P0001' && e.message === 'hold_exists') {
        // Point the buyer back to the hold they already have.
        const { rows } = await db.query<{ id: string }>(
          `select id from frames where holder = $1 and status = 'reserved'`, [req.ip],
        )
        // TODO: store each hold's checkout URL once a real provider is wired.
        const holdId = rows[0]?.id
        const checkoutUrl = holdId && payments.name === 'sandbox' ? `${config.publicUrl}/sandbox/checkout/${holdId}` : null
        return reply.code(409).send({ error: 'hold_exists', holdId: holdId ? Number(holdId) : null, checkoutUrl })
      }
      throw err
    }

    const expiresAt = new Date(Date.now() + config.reservationMinutes * 60_000)
    const checkout = await payments.createCheckout({
      frameId: id, priceUsd: price, expiresAt,
      description: `remember.me — ${b.size}×${b.size} frame at (${b.x}, ${b.y})`,
    })
    return reply.code(201).send({ id: Number(id), priceUsd: price, zone, expiresAt, checkoutUrl: checkout.url })
  })

  // Webhooks need the raw body to check the provider's signature.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body))
    scope.post('/webhooks/payments', async (req, reply) => {
      if (!payments.configured) return reply.code(503).send({ error: 'payments_unavailable' })
      const event = await payments.parseWebhook(req.headers, String(req.body ?? ''))
      if (!event) return reply.code(200).send({ ok: true })
      const { rows } = await db.query<{ ok: boolean }>('select activate_frame($1, $2) as ok', [event.frameId, event.paymentRef])
      if (!rows[0]?.ok) {
        // Paid after the hold was released: needs a refund. Logged for now.
        req.log.error({ event }, 'payment for a released hold')
      } else {
        stories.kick()
      }
      return { ok: true }
    })
  })

  if (payments.name === 'sandbox') {
    await app.register(sandboxRoutes, { db, frontendUrl: config.frontendUrl, onActivated: () => stories.kick() })
  }

  app.post<{ Params: { id: number }; Body: { reason?: string } }>('/frames/:id/reports', {
    schema: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { reason: { type: 'string', maxLength: 500 } },
      },
    },
  }, async (req, reply) => {
    const { rowCount } = await db.query(
      `insert into reports (frame_id, reason, reporter)
       select id, $2, $3 from frames where id = $1 and status = 'active'`,
      [req.params.id, req.body?.reason ?? '', req.ip],
    )
    if (!rowCount) return reply.code(404).send({ error: 'not_found' })
    return reply.code(202).send({ ok: true })
  })

  return app
}
