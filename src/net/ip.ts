/** IPv4 helpers. Addresses are handled as dotted strings in state and uint32 in math. */

export function ipToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function isValidIp(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export function isValidMask(mask: string | undefined | null): boolean {
  if (!mask || !isValidIp(mask)) return false;
  const n = ipToInt(mask);
  // contiguous ones followed by zeros
  const inv = ~n >>> 0;
  return (inv & (inv + 1)) === 0;
}

export function maskToPrefix(mask: string): number {
  let n = ipToInt(mask);
  let c = 0;
  while (n) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
}

export function prefixToMask(prefix: number): string {
  if (prefix <= 0) return '0.0.0.0';
  return intToIp((0xffffffff << (32 - prefix)) >>> 0);
}

export function networkOf(ip: string, mask: string): string {
  return intToIp((ipToInt(ip) & ipToInt(mask)) >>> 0);
}

export function broadcastOf(ip: string, mask: string): string {
  return intToIp(((ipToInt(ip) & ipToInt(mask)) | (~ipToInt(mask) >>> 0)) >>> 0);
}

export function sameSubnet(a: string, b: string, mask: string): boolean {
  const m = ipToInt(mask);
  return ((ipToInt(a) & m) >>> 0) === ((ipToInt(b) & m) >>> 0);
}

export function inNetwork(ip: string, net: string, mask: string): boolean {
  return sameSubnet(ip, net, mask);
}

/** Cisco wildcard match: bits set in wildcard are "don't care". */
export function wildcardMatch(ip: string, base: string, wildcard: string): boolean {
  const care = ~ipToInt(wildcard) >>> 0;
  return ((ipToInt(ip) & care) >>> 0) === ((ipToInt(base) & care) >>> 0);
}

export function isPrivate(ip: string): boolean {
  const n = ipToInt(ip);
  return (
    (n & 0xff000000) >>> 0 === 0x0a000000 ||
    (n & 0xfff00000) >>> 0 === 0xac100000 ||
    (n & 0xffff0000) >>> 0 === 0xc0a80000 ||
    (n & 0xffff0000) >>> 0 === 0xa9fe0000
  );
}

export function isApipa(ip: string | undefined): boolean {
  return !!ip && ip.startsWith('169.254.');
}

export function cidr(ip: string, mask: string): string {
  return `${networkOf(ip, mask)}/${maskToPrefix(mask)}`;
}

export function hostCount(mask: string): number {
  const p = maskToPrefix(mask);
  return Math.max(0, 2 ** (32 - p) - 2);
}

/** Parse "10.10.10.0/24" → { net, mask }. */
export function parseCidr(s: string): { net: string; mask: string } | null {
  const [ip, len] = s.split('/');
  const p = Number(len);
  if (!isValidIp(ip) || !Number.isInteger(p) || p < 0 || p > 32) return null;
  const mask = prefixToMask(p);
  return { net: networkOf(ip, mask), mask };
}

export function addIp(ip: string, delta: number): string {
  return intToIp((ipToInt(ip) + delta) >>> 0);
}

export function cmpIp(a: string, b: string): number {
  return ipToInt(a) - ipToInt(b);
}
