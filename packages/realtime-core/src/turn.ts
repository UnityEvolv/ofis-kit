import { createHmac } from 'node:crypto'

import type { IceServer } from './protocol/index.js'

/**
 * Short-lived relay credentials, minted per call join.
 *
 * Peer-to-peer works directly on a home network and fails on most corporate
 * ones, so a relay is not an optimisation — it is what makes calls work at all.
 * A relay is also bandwidth somebody pays for, which is why a credential cannot
 * be a shared password sitting in the client bundle where anybody can read it.
 *
 * This is coturn's standard REST scheme, which needs no database and no call from
 * coturn back to us. The username is an expiry timestamp, the password is an HMAC
 * of that username under a secret both sides hold, and coturn accepts it until
 * the timestamp passes. So a credential **expires by itself**, and one issued to
 * somebody in a call is no use to somebody who is not — which matters most for a
 * public demo that anybody can walk into.
 *
 * The secret never leaves the server. What a client receives is a username and a
 * password that are already on their way out.
 */

export interface TurnOptions {
  /**
   * The shared secret, the same value coturn was started with.
   *
   * Configuration, never a literal, and the only real secret the free office
   * has. Empty means no relay is configured, and the office says so rather than
   * handing out credentials nothing will accept.
   */
  secret: string
  /**
   * The relay URLs.
   *
   * From configuration, because no hostname is ever written down in the engine
   * and a laptop, the public demo and a private deployment all differ. These are
   * addresses a *browser* has to be able to reach, which is not the same as an
   * address the server can reach.
   */
  urls: string[]
  /** STUN, for the cases where a direct connection turns out to be possible. */
  stunUrls?: string[]
  /** How long a credential lasts. Long enough for a long call, and no longer. */
  ttlSeconds?: number
}

/**
 * Twelve hours.
 *
 * Longer than any call anybody will hold, and short enough that a credential
 * which somehow escaped stops mattering the same day. There is no revocation in
 * the REST scheme — the expiry *is* the revocation — so the number is the whole
 * of the answer to "what if one leaks".
 */
export const DEFAULT_TURN_TTL_SECONDS = 12 * 60 * 60

export interface TurnCredential {
  username: string
  credential: string
  expiresAt: string
}

/**
 * Mint a credential for one person's call leg.
 *
 * `identifier` goes into the username after the timestamp. coturn ignores it, and
 * it is there so a relay log can be tied back to a call leg without this server
 * keeping a table of who was issued what — which would be a database, and there
 * isn't one.
 */
export function mintTurnCredential(
  options: TurnOptions,
  identifier: string,
  now: number = Date.now(),
): TurnCredential {
  const ttl = options.ttlSeconds ?? DEFAULT_TURN_TTL_SECONDS
  const expiresAtSeconds = Math.floor(now / 1000) + ttl
  const username = `${expiresAtSeconds}:${identifier}`

  // SHA-1 because that is what coturn's REST scheme specifies. It is a message
  // authentication code under a secret, not a password hash, and the secret is
  // what the security rests on.
  const credential = createHmac('sha1', options.secret).update(username).digest('base64')

  return {
    username,
    credential,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  }
}

/**
 * The ICE configuration handed to a client at join.
 *
 * STUN first, so a direct connection is tried before a relayed one: direct costs
 * nobody anything and is the better path anyway. The relay is the fallback, and it
 * is never *forced* — a client that can connect directly should.
 *
 * With no secret and no URLs this returns nothing at all, which is the honest
 * answer for a laptop with no relay: calls will work on one network and fail
 * across a firewall, and the entry screen says so.
 */
export function iceServersFor(
  options: TurnOptions,
  identifier: string,
  now: number = Date.now(),
): IceServer[] {
  const servers: IceServer[] = []

  if (options.stunUrls && options.stunUrls.length > 0) {
    servers.push({ urls: options.stunUrls })
  }

  if (options.urls.length > 0 && options.secret) {
    const credential = mintTurnCredential(options, identifier, now)
    servers.push({
      urls: options.urls,
      username: credential.username,
      credential: credential.credential,
    })
  }

  return servers
}

/** Whether a relay is configured at all, which the host tells the client. */
export function hasTurn(options: TurnOptions): boolean {
  return options.urls.length > 0 && options.secret.length > 0
}

/**
 * Check a credential the way coturn would.
 *
 * Not used in the serving path — coturn does its own checking, which is the point
 * of the scheme. It exists so the test suite can assert that a credential stops
 * working when it expires, which is the property the whole thing is for and the
 * one that would otherwise be discovered by somebody abusing the demo.
 */
export function verifyTurnCredential(
  secret: string,
  username: string,
  credential: string,
  now: number = Date.now(),
): boolean {
  const [expiry] = username.split(':')
  const expiresAtSeconds = Number.parseInt(expiry ?? '', 10)
  if (!Number.isFinite(expiresAtSeconds)) return false
  if (expiresAtSeconds * 1000 <= now) return false
  return createHmac('sha1', secret).update(username).digest('base64') === credential
}
