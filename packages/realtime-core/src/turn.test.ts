import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TURN_TTL_SECONDS,
  hasTurn,
  iceServersFor,
  mintTurnCredential,
  verifyTurnCredential,
  type TurnOptions,
} from './turn.js'

/**
 * The relay credential scheme.
 *
 * coturn does the real checking, so `verifyTurnCredential` exists for these tests
 * and nothing else — it is how the property the scheme is *for* gets asserted
 * rather than assumed. Without it, "a credential stops working" is something you
 * find out when somebody abuses the demo.
 */

const SECRET = 'a-shared-secret-both-sides-hold'

function options(overrides: Partial<TurnOptions> = {}): TurnOptions {
  return {
    secret: SECRET,
    urls: ['turn:relay.example:3478?transport=udp'],
    stunUrls: ['stun:relay.example:3478'],
    ...overrides,
  }
}

const AT = Date.parse('2026-03-01T10:00:00.000Z')

describe('minting a credential', () => {
  it('puts the expiry in the username and signs it with the secret', () => {
    const credential = mintTurnCredential(options(), 'call-1:laptop', AT)

    // coturn's REST scheme: the username *is* the expiry, so the server needs no
    // database and never calls back to us to ask whether this is real.
    const [expiry, identifier] = credential.username.split(':')
    expect(Number(expiry)).toBe(Math.floor(AT / 1000) + DEFAULT_TURN_TTL_SECONDS)
    expect(identifier).toBe('call-1')
    expect(credential.credential).not.toContain(SECRET)
  })

  it('carries the call leg in the username, so a relay log can be traced back', () => {
    // Without it, tying relayed bytes to a call would need a table of who was
    // issued what, and there is no database to keep one in.
    const credential = mintTurnCredential(options(), 'call-7:phone', AT)
    expect(credential.username.endsWith(':call-7:phone')).toBe(true)
  })

  it('says when it expires, in UTC with the zone explicit', () => {
    const credential = mintTurnCredential(options({ ttlSeconds: 3600 }), 'x', AT)
    expect(credential.expiresAt).toBe('2026-03-01T11:00:00.000Z')
  })

  it('verifies against the same secret and nothing else', () => {
    const credential = mintTurnCredential(options(), 'x', AT)

    expect(verifyTurnCredential(SECRET, credential.username, credential.credential, AT)).toBe(true)
    expect(verifyTurnCredential('a-different-secret', credential.username, credential.credential, AT)).toBe(
      false,
    )
  })

  it('stops working once it has expired, which is the whole point', () => {
    // There is no revocation in this scheme — the expiry is the revocation — so a
    // credential that leaked stops mattering by itself.
    const credential = mintTurnCredential(options({ ttlSeconds: 60 }), 'x', AT)

    expect(verifyTurnCredential(SECRET, credential.username, credential.credential, AT + 30_000)).toBe(
      true,
    )
    expect(verifyTurnCredential(SECRET, credential.username, credential.credential, AT + 61_000)).toBe(
      false,
    )
  })

  it('will not accept a credential moved onto a different username', () => {
    // Which is the same thing as a credential minted for one call being no use
    // for another: the identifier is inside the signed string.
    const one = mintTurnCredential(options(), 'call-1:laptop', AT)
    const two = mintTurnCredential(options(), 'call-2:laptop', AT)

    expect(verifyTurnCredential(SECRET, two.username, one.credential, AT)).toBe(false)
    expect(one.credential).not.toBe(two.credential)
  })

  it('refuses a username that is not a timestamp at all', () => {
    expect(verifyTurnCredential(SECRET, 'not-a-timestamp:x', 'anything', AT)).toBe(false)
    expect(verifyTurnCredential(SECRET, '', 'anything', AT)).toBe(false)
  })
})

describe('the ICE configuration a client is handed', () => {
  it('puts STUN first, so a direct connection is tried before a relayed one', () => {
    // Direct costs nobody anything and is the better path anyway. The relay is a
    // fallback and is never forced.
    const servers = iceServersFor(options(), 'call-1:laptop', AT)

    expect(servers).toHaveLength(2)
    expect(servers[0]).toEqual({ urls: ['stun:relay.example:3478'] })
    expect(servers[1]?.urls).toEqual(['turn:relay.example:3478?transport=udp'])
  })

  it('never hands over the secret', () => {
    const servers = iceServersFor(options(), 'call-1:laptop', AT)
    expect(JSON.stringify(servers)).not.toContain(SECRET)
  })

  it('gives a different credential to every leg, from the same secret', () => {
    const laptop = iceServersFor(options(), 'call-1:laptop', AT)[1]
    const phone = iceServersFor(options(), 'call-1:phone', AT)[1]

    expect(laptop?.username).not.toBe(phone?.username)
    expect(laptop?.credential).not.toBe(phone?.credential)
  })

  it('offers nothing at all when no relay is configured', () => {
    // The honest answer for a laptop with nothing set up: calls work on one
    // network and fail across a firewall, and the entry screen says so rather
    // than the client being handed credentials nothing will accept.
    expect(iceServersFor(options({ urls: [], stunUrls: [] }), 'x', AT)).toEqual([])

    // A secret-less office still offers STUN, which needs no credential — but not
    // a relay, because a relay with no credential is a relay that refuses you.
    const noSecret = iceServersFor(options({ secret: '' }), 'x', AT)
    expect(noSecret.every((one) => one.username === undefined)).toBe(true)
  })

  it('offers STUN without a relay, when that is all there is', () => {
    const servers = iceServersFor(options({ urls: [] }), 'x', AT)
    expect(servers).toHaveLength(1)
    expect(servers[0]?.username).toBeUndefined()
  })

  it('knows whether a relay is configured, which is what the client is told', () => {
    expect(hasTurn(options())).toBe(true)
    expect(hasTurn(options({ secret: '' }))).toBe(false)
    expect(hasTurn(options({ urls: [] }))).toBe(false)
  })
})
