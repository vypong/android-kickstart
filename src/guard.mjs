// Request guards for the local GUI server. The server writes files and runs Gradle, so a page
// on any other origin must not be able to drive it. These live here, apart from the server, so
// they can be tested without opening a port.

import { timingSafeEqual } from 'node:crypto';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * DNS rebinding points an attacker's domain at 127.0.0.1, which would make their page
 * same-origin with us and so able to read our token. Such a request still carries their
 * hostname in Host, so requiring a loopback literal rejects it.
 */
export function hostIsLoopback(hostHeader) {
  if (!hostHeader) return false;                          // HTTP/1.1 requires Host
  const host = String(hostHeader).trim().toLowerCase();
  const bare = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOOPBACK.has(bare);
}

/**
 * A per-run token the browser learns only by loading our own page; the same-origin policy
 * stops another origin from reading that response. A blind cross-site request - an <img> src,
 * a form post, fetch() with no-cors - cannot guess it.
 */
export function tokenMatches(expected, given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  // timingSafeEqual throws on a length mismatch, so screen that first.
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
