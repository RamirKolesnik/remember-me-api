// Fake checkout for test environments (PAYMENT_PROVIDER=sandbox). No money moves.
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

interface HoldRow {
  id: string
  x: number
  y: number
  size: number
  price_usd: number
  name: string
  status: string
  expires_at: Date | null
}

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test checkout — remember.me</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F6F5F1;font:16px/1.5 Inter,system-ui,sans-serif;color:#18171C}
main{width:min(420px,100% - 32px);background:#fff;border:1px solid #E4E2DA;border-radius:14px;padding:28px;display:flex;flex-direction:column;gap:18px}
.tag{align-self:flex-start;padding:4px 10px;border-radius:999px;background:#FAEEDA;color:#633806;font-size:12px;font-weight:600}
h1{margin:0;font-size:24px}.price{font-size:40px;font-weight:600}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:14px}dt{color:#5F5E5A}dd{margin:0}
form{margin:0}button{width:100%;min-height:52px;border-radius:10px;font:inherit;font-weight:600;cursor:pointer}
.pay{background:#18171C;color:#fff;border:0}.cancel{background:#fff;color:#18171C;border:1px solid #E4E2DA}
.muted{color:#5F5E5A;font-size:13px;margin:0}
</style></head><body><main>${body}</main></body></html>`
}

export async function sandboxRoutes(app: FastifyInstance, opts: { db: pg.Pool; frontendUrl: string }) {
  const { db, frontendUrl } = opts
  // The checkout page posts plain HTML forms with no fields.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, _body, done) => done(null, {}))

  const idSchema = { params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } } }

  app.get<{ Params: { id: number } }>('/sandbox/checkout/:id', { schema: idSchema }, async (req, reply) => {
    const { rows } = await db.query<HoldRow>(
      'select id, x, y, size, price_usd, name, status, expires_at from frames where id = $1', [req.params.id],
    )
    const f = rows[0]
    reply.type('text/html; charset=utf-8')
    if (!f) return reply.code(404).send(page('<h1>Hold not found</h1>'))
    if (f.status !== 'reserved') {
      return page(`<h1>This hold is ${esc(f.status)}</h1><a href="${esc(frontendUrl)}/">Back to the wall</a>`)
    }
    const minutes = f.expires_at ? Math.max(0, Math.round((f.expires_at.getTime() - Date.now()) / 60000)) : 0
    return page(`
<span class="tag">TEST PAYMENT — no money moves</span>
<h1>remember.me</h1>
<div class="price">$${f.price_usd.toLocaleString('en-US')}</div>
<dl>
<dt>Frame</dt><dd>${f.size}×${f.size} at (${f.x}, ${f.y})</dd>
<dt>Name</dt><dd>${esc(f.name)}</dd>
<dt>Hold ends</dt><dd>in ~${minutes} min</dd>
</dl>
<form method="post" action="/sandbox/checkout/${f.id}/pay"><button class="pay" type="submit">Pay $${f.price_usd.toLocaleString('en-US')} (test)</button></form>
<form method="post" action="/sandbox/checkout/${f.id}/cancel"><button class="cancel" type="submit">Cancel and free the spot</button></form>
<p class="muted">This page stands in for the real payment provider in the test environment.</p>`)
  })

  app.post<{ Params: { id: number } }>('/sandbox/checkout/:id/pay', { schema: idSchema }, async (req, reply) => {
    const id = req.params.id
    const { rows } = await db.query<{ ok: boolean }>('select activate_frame($1, $2) as ok', [id, `sandbox_${id}_${Date.now()}`])
    const status = rows[0]?.ok ? 'paid' : 'expired'
    return reply.redirect(`${frontendUrl}/immortalize/done?id=${id}&status=${status}`, 303)
  })

  app.post<{ Params: { id: number } }>('/sandbox/checkout/:id/cancel', { schema: idSchema }, async (req, reply) => {
    await db.query('select release_hold($1)', [req.params.id])
    return reply.redirect(`${frontendUrl}/immortalize/spot?cancelled=1`, 303)
  })
}
