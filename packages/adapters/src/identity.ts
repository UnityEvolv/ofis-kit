import type { ErrorEnvelope } from '@unityevolv/ofiskit-template'

/**
 * The question the office asks its host: who is this, and may they do this?
 *
 * This interface is the boundary. The engine never queries organizations,
 * memberships, roles or plans, because in this repository none of those exist;
 * it asks. The free office answers with a typed email and yes to everything.
 * unityofis validates a session token and answers from memberships, roles,
 * restriction, guest grants and plan limits. The same `room:join` handler
 * refuses a restricted room there and allows it here, with no code difference
 * between them, and that is the whole point.
 *
 * If the engine ever needs to know something it cannot ask here, the answer is a
 * new question on this interface, not a lookup somewhere else.
 */

/** A person, as far as the office is concerned. */
export interface Identity {
  /**
   * Stable for this person, across connections and devices.
   *
   * The adapter owns this id space: unityofis hands out its database's UUIDv7,
   * and the built-in adapter derives one from the email so two browser tabs are
   * one person rather than two.
   */
  id: string
  displayName: string
  photoUrl?: string
  /**
   * Guests are in the room like anyone else and can join the call; they cannot
   * lock a room or invite. There are no guests in the free office, so its
   * adapter never sets this.
   */
  isGuest?: boolean
  /**
   * A status the host knows about and the engine cannot work out, such as being
   * in a meeting that is happening somewhere else. The free office has no
   * calendar and never sets it.
   */
  externalStatus?: 'in_meeting' | null
}

/**
 * Everything the office might want permission for.
 *
 * A closed list rather than a string, so adding a question is a change the
 * compiler shows every adapter, rather than one that silently defaults to
 * allowed in somebody's implementation.
 */
export type Permission =
  | 'enter_office'
  | 'join_room'
  | 'lock_room'
  | 'knock'
  | 'invite'
  | 'join_call'

export interface PermissionQuestion {
  permission: Permission
  identity: Identity
  officeId: string
  /** Present for every room-scoped question. */
  roomId?: string
}

/**
 * Yes, or no with a reason.
 *
 * The reason is not decoration: the room bar shows it under the disabled
 * control, so "you cannot join" has to be able to say whether that is because
 * the room is restricted, because the plan caps it, or because the person is a
 * guest. A refusal a client cannot tell from another refusal is a bug in the
 * contract.
 */
export type Decision = { allowed: true } | ({ allowed: false } & ErrorEnvelope)

export const allow = (): Decision => ({ allowed: true })
export const refuse = (code: string, message: string): Decision => ({
  allowed: false,
  code,
  message,
})

/** What the engine knows about a connection before it knows who is on it. */
export interface ConnectionContext {
  connectionId: string
  /** Stable per installation, so a reconnect is the same device. */
  deviceId: string
  kind: 'web' | 'desktop' | 'mobile'
}

/** Authentication failed. The socket is told, and closed. */
export interface AuthenticationRefused extends ErrorEnvelope {
  authenticated: false
}

export interface IdentityAdapter {
  /**
   * Turn a connection's credentials into a person.
   *
   * Called when a socket connects and again whenever the client sends a
   * refreshed credential over the existing socket. A successful re-check
   * updates the connection's identity in place, so a token refresh does not
   * make anyone's presence flicker.
   */
  authenticate(
    credentials: unknown,
    context: ConnectionContext,
  ): Promise<Identity | AuthenticationRefused>

  /** May this person do this? Asked at the moment of the action, never cached. */
  may(question: PermissionQuestion): Promise<Decision>

  /**
   * Somebody moved, or left.
   *
   * Optional, and the free office does not implement it. unityofis uses it to
   * remember the last office and room on the membership, so the next sign-in
   * puts a person back where they were.
   */
  onPresenceChanged?(event: {
    identity: Identity
    officeId: string
    roomId: string | null
  }): Promise<void>
}

/**
 * A stable id derived from an email address.
 *
 * Version 8, which RFC 9562 reserves for exactly this: an id whose bits are
 * decided by the application rather than by a clock. It has to be derived rather
 * than minted, because the same person opening a second tab must come back as
 * the same person, and there is nothing here remembering who anyone is.
 *
 * The email is lower-cased and trimmed first, so `Ada@Example.com ` and
 * `ada@example.com` are one person rather than two standing in the same room.
 *
 * Hashed with Web Crypto, which Node (20 and later), browsers and React Native
 * all have, so this package runs anywhere the engine does. It is asynchronous only
 * because that API is.
 */
export async function idForEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLocaleLowerCase())
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const digest = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const version8 = `8${digest.slice(13, 16)}`
  // Variant bits: the first character of this group must be 8, 9, a or b.
  const variant = `${'89ab'[Number.parseInt(digest[16] ?? '0', 16) % 4]}${digest.slice(17, 20)}`
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${version8}-${variant}-${digest.slice(20, 32)}`
}

/** Anything that is shaped like an email. Nothing checks that it exists. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface TypedEmailCredentials {
  email: string
  name: string
}

/**
 * The free office's identity adapter: type an email and a name, and you are in.
 *
 * The email is who you are and nothing checks it. There is no account, no
 * verification and no password, which is honest for something that persists
 * nothing and is exactly what makes the boundary visible: this adapter is forty
 * lines and answers yes to every permission, and the engine above it cannot tell
 * the difference between that and unityofis asking a database.
 *
 * It does validate the shape of what was typed, because a blank name draws a
 * blank avatar and an obviously-not-an-email address helps nobody.
 */
export function typedEmailIdentity(): IdentityAdapter {
  return {
    async authenticate(credentials: unknown): Promise<Identity | AuthenticationRefused> {
      const given = credentials as Partial<TypedEmailCredentials> | null

      const email = typeof given?.email === 'string' ? given.email.trim() : ''
      const name = typeof given?.name === 'string' ? given.name.trim() : ''

      if (!EMAIL.test(email)) {
        return {
          authenticated: false,
          code: 'identity.email_invalid',
          message: 'That does not look like an email address. Nothing checks it, but it is your name here.',
        }
      }
      if (name.length === 0) {
        return {
          authenticated: false,
          code: 'identity.name_required',
          message: 'Please type a name, so people can tell who has walked in.',
        }
      }
      if (name.length > 60) {
        return {
          authenticated: false,
          code: 'identity.name_too_long',
          message: 'That name is too long to fit under an avatar. Sixty characters at most.',
        }
      }

      return { id: await idForEmail(email), displayName: name }
    },

    // Yes to everything. The free office has one office, no roles and no plan,
    // so there is nothing here that could say no.
    async may(): Promise<Decision> {
      return allow()
    },
  }
}
