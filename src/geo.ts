// The buyer's country from their IP. A CDN header wins when there is one
// (Cloudflare's cf-ipcountry); otherwise the offline GeoLite2 data of
// fast-geoip is read. Any failure means "unknown", never a failed purchase.
import { BlockList, isIP } from 'node:net'
import { countryCode } from './domain/country.ts'

// Private, loopback and shared ranges belong to no country.
const LOCAL = new BlockList()
for (const [net, bits] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['100.64.0.0', 10], ['0.0.0.0', 8]] as const) LOCAL.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [['::1', 128], ['fc00::', 7], ['fe80::', 10], ['::', 128]] as const) LOCAL.addSubnet(net, bits, 'ipv6')

function isPublic(ip: string): boolean {
  const v = isIP(ip)
  if (!v) return false
  // An IPv4 address mapped into IPv6 (::ffff:10.0.0.1) is checked as IPv4.
  const mapped = v === 6 && /^::ffff:(\d+\.){3}\d+$/i.test(ip) ? ip.slice(7) : null
  if (mapped) return !LOCAL.check(mapped, 'ipv4')
  return !LOCAL.check(ip, v === 4 ? 'ipv4' : 'ipv6')
}

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
  if (!isPublic(ip)) return null
  try {
    const find = await loadLookup()
    if (!find) return null
    return countryCode((await find(ip.replace(/^::ffff:/i, '')))?.country)
  } catch {
    return null
  }
}
