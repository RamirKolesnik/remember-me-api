// Countries of buyers. A country is an ISO 3166-1 alpha-2 code ("US", "UZ").

/** Codes that are not a country: unknown (XX, ZZ), Tor (T1), anonymous proxies (A1, A2), EU, AP. */
const NOT_A_COUNTRY = new Set(['XX', 'ZZ', 'T1', 'A1', 'A2', 'O1', 'EU', 'AP'])

/** A clean country code, or null. Lowercase is accepted. */
export function countryCode(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const c = v.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c) || NOT_A_COUNTRY.has(c)) return null
  return c
}

export interface CountryCount { code: string; count: number }

/**
 * Countries with the most frames first (ties by code), and frames whose
 * country is unknown. Shares are left to the site.
 */
export function rankCountries(rows: readonly { country: string | null; n: number }[]): {
  total: number
  unknown: number
  countries: CountryCount[]
} {
  let total = 0, unknown = 0
  const by = new Map<string, number>()
  for (const r of rows) {
    total += r.n
    const c = countryCode(r.country)
    if (!c) { unknown += r.n; continue }
    by.set(c, (by.get(c) ?? 0) + r.n)
  }
  const countries = [...by].map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
  return { total, unknown, countries }
}
