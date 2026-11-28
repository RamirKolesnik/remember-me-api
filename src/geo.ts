// The buyer's country from their IP. A CDN header wins when there is one
// (Cloudflare's cf-ipcountry); otherwise the offline GeoLite2 data of
// fast-geoip is read. Any failure means "unknown", never a failed purchase.
import { isIP } from 'node:net'
import { countryCode } from './domain/country.ts'

type Lookup = (ip: string) => Promise<{ country?: string } | null>
let lookup: Promise<Lookup | null> | null = null

function loadLookup(): Promise<Lookup | null> {
  // Imported by name so the server still starts if the package is missing.
  const pkg = 'fast-geoip'
  lookup ??= import(pkg)
    .then((m: { default?: { lookup?: Lookup }; lookup?: Lookup }) => m.default?.lookup ?? m.lookup ?? null)
    .catch(() => null)
  return lookup
}

export async function countryOf(headers: Record<string, string | string[] | undefined>, ip: string): Promise<string | null> {
  const header = headers['cf-ipcountry']
  const fromHeader = countryCode(Array.isArray(header) ? header[0] : header)
  if (fromHeader) return fromHeader
  if (!isIP(ip)) return null
  try {
    const find = await loadLookup()
    if (!find) return null
    return countryCode((await find(ip))?.country)
  } catch {
    return null
  }
}
