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
  /** Empty: payments are not configured yet and checkout is refused. */
  paymentProvider: string
}

export function loadConfig(): Config {
  return {
    port: int('PORT', 8080),
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/remember_me',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,https://ramirkolesnik.github.io')
      .split(',').map((s) => s.trim()).filter(Boolean),
    reservationMinutes: int('RESERVATION_MINUTES', 15),
    captchaSecret: process.env.CAPTCHA_SECRET ?? '',
    paymentProvider: process.env.PAYMENT_PROVIDER ?? '',
  }
}
