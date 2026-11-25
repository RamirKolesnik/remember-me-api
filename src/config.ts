function int(name: string, fallback: number): number {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`)
  return n
}

export interface Config {
  port: number
  host: string
  databaseUrl: string
  /** Comma-separated list of allowed browser origins. */
  corsOrigins: string[]
  reservationMinutes: number
  /** Empty: captcha checks are skipped (local development only). */
  captchaSecret: string
  /** Empty: payments are not configured and checkout is refused. "sandbox": fake checkout for testing. */
  paymentProvider: string
  /** Where this API is reachable from browsers, without a trailing slash. */
  publicUrl: string
  /** Where the website lives, without a trailing slash: checkout returns there. */
  frontendUrl: string
  /** Site name printed on story cards. Empty: taken from frontendUrl. */
  storySiteLabel: string
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export function loadConfig(): Config {
  const port = int('PORT', 8080)
  return {
    port,
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/remember_me',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,https://ramirkolesnik.github.io')
      .split(',').map((s) => s.trim()).filter(Boolean),
    reservationMinutes: int('RESERVATION_MINUTES', 15),
    captchaSecret: process.env.CAPTCHA_SECRET ?? '',
    paymentProvider: process.env.PAYMENT_PROVIDER ?? '',
    // Render sets RENDER_EXTERNAL_URL for every web service.
    publicUrl: trimSlash(process.env.API_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`),
    frontendUrl: trimSlash(process.env.FRONTEND_URL || 'http://localhost:3000'),
    storySiteLabel: process.env.STORY_SITE_LABEL ?? '',
  }
}
