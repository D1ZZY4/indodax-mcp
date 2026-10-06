/**
 * Egress addresses, resolved once and reused.
 *
 * An `Unauthorized IP address` rejection names no address, so an operator
 * cannot tell which value belongs in the exchange allowlist and often
 * whitelists the wrong family. A residential or dual stack host commonly
 * reaches the exchange over IPv6 even when the operator checked an IPv4
 * lookup, which is exactly the case this makes visible.
 *
 * Resolution is best effort: the values are attached to a rejection as a hint,
 * never required for one to be raised, so a lookup failure cannot break a call.
 */

export interface EgressAddresses {
  ipv4: string | null;
  ipv6: string | null;
  /** True when the values came from a live lookup rather than cache. */
  fresh: boolean;
}

let cached: EgressAddresses | null = null;
let pending: Promise<EgressAddresses> | null = null;

const TIMEOUT_MS = 2500;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function extract(candidate: unknown, pattern: RegExp): string | null {
  if (typeof candidate !== "string") return null;
  const match = pattern.exec(candidate.trim());
  return match === null ? null : match[0];
}

async function query(fetchFn: FetchLike, url: string, pattern: RegExp): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    if (!response.ok) return null;
    return extract(await response.text(), pattern);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolve(fetchFn: FetchLike): Promise<EgressAddresses> {
  const [ipv4, ipv6] = await Promise.all([
    query(fetchFn, "https://api.ipify.org", /^(\d{1,3}(?:\.\d{1,3}){3})$/),
    query(fetchFn, "https://api6.ipify.org", /^[0-9a-f:]+$/i),
  ]);
  return { ipv4, ipv6, fresh: true };
}

/**
 * Egress addresses for the current host, resolved once per process.
 *
 * Never throws. A failure yields null values so the caller can still report
 * the rejection without them. Pass a fetch implementation only in tests;
 * production callers use the global fetch.
 */
export async function egressAddresses(fetchFn: FetchLike = fetch): Promise<EgressAddresses> {
  if (cached !== null) return { ...cached, fresh: false };
  pending ??= resolve(fetchFn)
    .then((result) => {
      // A partial answer is still worth caching; a total failure is not, so a
      // later call can try again once the network recovers.
      if (result.ipv4 !== null || result.ipv6 !== null) cached = result;
      return result;
    })
    .finally(() => {
      pending = null;
    });
  try {
    return await pending;
  } catch {
    return { ipv4: null, ipv6: null, fresh: false };
  }
}

/** One line suitable for an error message. */
export function describeEgress(addresses: EgressAddresses): string {
  if (addresses.ipv4 === null && addresses.ipv6 === null) {
    return "the public egress addresses could not be resolved from this host";
  }
  const parts: string[] = [];
  if (addresses.ipv4 !== null) parts.push(`IPv4 ${addresses.ipv4}`);
  if (addresses.ipv6 !== null) parts.push(`IPv6 ${addresses.ipv6}`);
  return `this host reaches the exchange via ${parts.join(" and ")}; allowlist the matching family`;
}

/** Test seam: an availability observation must not leak between cases. */
export function resetEgressCache(): void {
  cached = null;
  pending = null;
}

/** Egress hint shaped for rejection translation. Never throws. */
export interface EgressHint {
  note: string | null;
  ipv4: string | null;
  ipv6: string | null;
}

/**
 * Resolve the hint for an IP rejection. Runs the lookup only when asked, so
 * callers pay no network cost on rejections that need no address.
 */
export async function egressHint(fetchFn: FetchLike = fetch): Promise<EgressHint> {
  const addresses = await egressAddresses(fetchFn);
  const empty = addresses.ipv4 === null && addresses.ipv6 === null;
  return {
    note: empty ? null : describeEgress(addresses),
    ipv4: addresses.ipv4,
    ipv6: addresses.ipv6,
  };
}
