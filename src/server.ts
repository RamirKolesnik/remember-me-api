import pg from 'pg'
import { loadConfig } from './config.ts'
import { buildApp } from './app.ts'
import { createCaptcha } from './adapters/captcha.ts'
import { createPayments } from './adapters/payments.ts'
import { createModerator } from './adapters/moderation.ts'
import { migrate } from './db/migrate.ts'
import { seedDemoIfEmpty } from './db/seed.ts'
import { createStories, siteLabelOf } from './stories.ts'

const config = loadConfig()
await migrate(config.databaseUrl)

const db = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
if (config.seedDemo) {
  const added = await seedDemoIfEmpty(db)
  if (added) console.log(`Seeded ${added} demo frames`)
}

const log = {
  info: (obj: object, msg: string) => console.log(msg, JSON.stringify(obj)),
  error: (obj: object, msg: string) => console.error(msg, obj),
}
const stories = createStories({ db, siteLabel: config.storySiteLabel || siteLabelOf(config.frontendUrl), log })

const app = await buildApp({
  config,
  db,
  captcha: createCaptcha(config.captchaSecret, console),
  payments: createPayments(config.paymentProvider, config.publicUrl),
  moderator: createModerator(),
  stories,
})

// Story cards of frames paid while the server was down.
stories.kick()

// Release expired holds every minute.
const sweeper = setInterval(() => {
  db.query('select expire_reservations() as n')
    .then(({ rows }) => { if (rows[0]?.n) app.log.info({ released: rows[0].n }, 'released expired holds') })
    .catch((err) => app.log.error(err, 'expire_reservations failed'))
}, 60_000)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    clearInterval(sweeper)
    await stories.idle()
    await app.close()
    await db.end()
    process.exit(0)
  })
}

await app.listen({ port: config.port, host: config.host })
