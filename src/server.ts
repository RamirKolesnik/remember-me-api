import pg from 'pg'
import { loadConfig } from './config.ts'
import { buildApp } from './app.ts'
import { createCaptcha } from './adapters/captcha.ts'
import { createPayments } from './adapters/payments.ts'
import { migrate } from './db/migrate.ts'

const config = loadConfig()
await migrate(config.databaseUrl)

const db = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
const app = await buildApp({
  config,
  db,
  captcha: createCaptcha(config.captchaSecret, console),
  payments: createPayments(config.paymentProvider),
})

// Release expired holds every minute.
const sweeper = setInterval(() => {
  db.query('select expire_reservations() as n')
    .then(({ rows }) => { if (rows[0]?.n) app.log.info({ released: rows[0].n }, 'released expired holds') })
    .catch((err) => app.log.error(err, 'expire_reservations failed'))
}, 60_000)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    clearInterval(sweeper)
    await app.close()
    await db.end()
    process.exit(0)
  })
}

await app.listen({ port: config.port, host: config.host })
