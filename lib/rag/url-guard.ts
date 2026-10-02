import { lookup as dnsLookup } from "node:dns/promises";

/**
 * Guards server-side fetches of user-supplied URLs.
 *
 * Document ingestion fetches a URL the user typed and stores the response where they can
 * read it back, which is a textbook SSRF primitive: without this, any signed-in user
 * could point the server at cloud metadata, an internal admin service or a database port
 * and read the reply through a cited answer.
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

type LookupResult = { address: string; family: number };
export type Lookup = (hostname: string, options: { all: true }) => Promise<LookupResult[]>;

const BLOCKED_HOST_SUFFIXES = [".internal", ".local", ".localhost", ".home.arpa"];
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

export async function assertFetchableUrl(
  input: string,
  options: { lookup?: Lookup } = {},
): Promise<URL> {
  const lookup = options.lookup ?? (dnsLookup as unknown as Lookup);
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new UnsafeUrlError("That is not a valid URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new UnsafeUrlError("Only http and https URLs can be fetched.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new UnsafeUrlError("That host is internal and not allowed.");
  }

  // An IP literal needs no lookup; a name does, because a public name is free to resolve
  // to a private address (DNS rebinding).
  const addresses = isIpAddress(hostname) ? [hostname] : await resolve(lookup, hostname);

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new UnsafeUrlError("That URL points at a private or internal address.");
    }
  }

  return url;
}

async function resolve(lookup: Lookup, hostname: string): Promise<string[]> {
  try {
    const results = await lookup(hostname, { all: true });

    if (results.length === 0) throw new Error("no addresses");

    return results.map((result) => result.address);
  } catch {
    throw new UnsafeUrlError(`Could not resolve ${hostname}.`);
  }
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

export function isPrivateAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];

  if (host.includes(":")) return isPrivateIpv6(host);

  const octets = host.split(".").map(Number);

  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) return true;

  const [a, b] = octets;

  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && b >= 18 && b <= 19) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

function isPrivateIpv6(host: string): boolean {
  if (host === "::" || host === "::1") return true;
  // Unique local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
  // IPv4-mapped (::ffff:a.b.c.d) must be judged by the embedded address.
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);

  if (mapped) return isPrivateAddress(mapped[1]);

  return false;
}
