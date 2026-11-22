import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type pg from 'pg'
import type { Config } from './config.ts'
import type { CaptchaVerifier } from './adapters/captcha.ts'
import type { PaymentProvider } from './adapters/payments.ts'
import {
  containsLink, isHeart, NAME_MAX, NOTE_MAX, placementError, priceOf, WALL_SIZE, zoneOfFrame,
  type FrameSize,
} from './domain/wall.ts'

export interface Deps {
  config: Config
  db: pg.Pool
  captcha: CaptchaVerifier
  payments: PaymentProvider
}

interface FrameRow {
  id: string
  x: number
  y: number
  size: number
  zone: number
  name: string
  note: string
  photo_key: string | null
  paid_at: Date | null
}

const toFrame = (r: FrameRow) => ({
  id: Number(r.id), x: r.x, y: r.y, size: r.size, zone: r.zone,
  name: r.name, note: r.note, photoKey: r.photo_key, placedAt: r.paid_at,
})

const MAX_VIEW_CELLS = 250_000 // a 500x500 window at most per request

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const { config, db, captcha, payments } = deps
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 64 * 1024 })
  await app.register(cors, { origin: config.corsOrigins })

  app.get('/health', async () => {
    await db.query('select 1')
    return { ok: true }
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
      `select id, x, y, size, zone, name, note, photo_key, paid_at from frames
       where status = 'active' and x <= $3 and x + size - 1 >= $1 and y <= $4 and y + size - 1 >= $2`,
      [x0, y0, x1, y1],
    )
    reply.header('cache-control', 'public, max-age=15')
    return { frames: rows.map(toFrame) }
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
    return { priceUsd: priceOf(x, y, size), zone: isHeart(x, y, size) ? 0 : zoneOfFrame(x, y, size).id }
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
          photoKey: { type: 'string', maxLength: 200 },
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
    if (!(await captcha.verify(b.captchaToken, req.ip))) return reply.code(403).send({ error: 'captcha_failed' })
    if (!payments.configured) return reply.code(503).send({ error: 'payments_unavailable' })

    const heart = isHeart(b.x, b.y, b.size)
    const zone = heart ? 0 : zoneOfFrame(b.x, b.y, b.size).id
    const price = priceOf(b.x, b.y, b.size)

    let id: string
    try {
      const { rows } = await db.query<{ id: string }>(
        'select reserve_frame($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as id',
        [b.x, b.y, b.size, zone, price, name, note, b.photoKey ?? null, req.ip, config.reservationMinutes],
      )
      id = rows[0]!.id
    } catch (err) {
      const msg = (err as { code?: string; message?: string })
      if (msg.code === 'P0001' && msg.message === 'spot_taken') return reply.code(409).send({ error: 'spot_taken' })
      if (msg.code === 'P0001' && msg.message === 'hold_exists') return reply.code(409).send({ error: 'hold_exists' })
      throw err
    }

    const expiresAt = new Date(Date.now() + config.reservationMinutes * 60_000)
    const checkout = await payments.createCheckout({
      frameId: id, priceUsd: price, expiresAt,
      description: heart ? 'remember.me — the heart of the wall' : `remember.me — ${b.size}×${b.size} frame at (${b.x}, ${b.y})`,
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
      }
      return { ok: true }
    })
  })

  app.post<{ Params: { id: number }; Body: { reason?: string } }>('/frames/:id/reports', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } },
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
