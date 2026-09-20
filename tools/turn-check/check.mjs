/**
 * Prove that the relay actually relays, against a real coturn.
 *
 * The unit tests prove the credential scheme is internally consistent. They
 * cannot prove that coturn agrees with it — and coturn disagreeing is the failure
 * that matters, because it looks exactly like "calls do not work on some
 * networks" and nothing in the office logs says why.
 *
 * So this speaks STUN and TURN on the wire, with no WebRTC stack involved:
 *
 *   1. A STUN Binding request, which proves the server is there and answers.
 *   2. A TURN Allocate with a minted credential, which proves coturn computes the
 *      same HMAC we do and will hand out a relayed address.
 *   3. A TURN Allocate with an expired credential, which proves it refuses one.
 *
 * Step three is the one worth having. An open relay is the classic way to lose a
 * TURN server, and "our credentials expire" is a claim, not a fact, until
 * something has watched a stale one be rejected.
 *
 *   node tools/turn-check/check.mjs
 *
 * Reads TURN_SECRET, TURN_HOST and TURN_PORT from the environment, because no
 * hostname is ever written down in this repository.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { createSocket } from 'node:dgram'

const HOST = process.env.TURN_HOST ?? '127.0.0.1'
const PORT = Number(process.env.TURN_PORT ?? 3478)
const SECRET = process.env.TURN_SECRET ?? ''
const REALM = process.env.TURN_REALM ?? 'ofiskit'
const TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS ?? 4000)

if (!SECRET) {
  console.error('TURN_SECRET is not set. It has to be the same value coturn was started with.')
  process.exit(1)
}

/** The magic cookie every STUN message carries, so a reply can be recognised. */
const MAGIC_COOKIE = 0x2112a442

const METHOD = { binding: 0x0001, allocate: 0x0003 }
const CLASS = { request: 0x0000, success: 0x0100, error: 0x0110 }

const ATTR = {
  mappedAddress: 0x0001,
  username: 0x0006,
  messageIntegrity: 0x0008,
  errorCode: 0x0009,
  realm: 0x0014,
  nonce: 0x0015,
  xorRelayedAddress: 0x0016,
  requestedTransport: 0x0019,
  xorMappedAddress: 0x0020,
}

/** One attribute, padded to a multiple of four as STUN requires. */
function attribute(type, value) {
  const padding = (4 - (value.length % 4)) % 4
  const header = Buffer.alloc(4)
  header.writeUInt16BE(type, 0)
  header.writeUInt16BE(value.length, 2)
  return Buffer.concat([header, value, Buffer.alloc(padding)])
}

/**
 * Build a STUN/TURN message, optionally signed.
 *
 * MESSAGE-INTEGRITY is an HMAC over the message *including a length that counts
 * the attribute itself*, which is the detail that makes hand-rolled STUN fail
 * silently. The length is written before the HMAC is computed.
 */
function message({ method, transactionId, attributes = [], key = null }) {
  const body = Buffer.concat(attributes)
  const header = Buffer.alloc(20)
  header.writeUInt16BE(method | CLASS.request, 0)
  header.writeUInt16BE(body.length, 2)
  header.writeUInt32BE(MAGIC_COOKIE, 4)
  transactionId.copy(header, 8)

  if (!key) return Buffer.concat([header, body])

  // 24 = the integrity attribute's own 4-byte header plus its 20-byte value.
  header.writeUInt16BE(body.length + 24, 2)
  const digest = createHmac('sha1', key).update(Buffer.concat([header, body])).digest()
  return Buffer.concat([header, body, attribute(ATTR.messageIntegrity, digest)])
}

function parse(packet) {
  const type = packet.readUInt16BE(0)
  const length = packet.readUInt16BE(2)
  const attributes = new Map()

  let offset = 20
  const end = 20 + length
  while (offset + 4 <= end && offset + 4 <= packet.length) {
    const attributeType = packet.readUInt16BE(offset)
    const attributeLength = packet.readUInt16BE(offset + 2)
    attributes.set(attributeType, packet.subarray(offset + 4, offset + 4 + attributeLength))
    offset += 4 + attributeLength + ((4 - (attributeLength % 4)) % 4)
  }

  return {
    isSuccess: (type & 0x0110) === CLASS.success,
    isError: (type & 0x0110) === CLASS.error,
    attributes,
  }
}

/** The numeric code out of an ERROR-CODE attribute, or null. */
function errorCode(attributes) {
  const value = attributes.get(ATTR.errorCode)
  if (!value || value.length < 4) return null
  return value[2] * 100 + value[3]
}

/** Send one message and wait for the reply to the same transaction. */
function exchange(socket, packet, transactionId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      reject(new Error(`no answer from ${HOST}:${PORT} within ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)

    const onMessage = (reply) => {
      // Only ours: a relay under load is answering other people at the same time.
      if (reply.length < 20 || !reply.subarray(8, 20).equals(transactionId)) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(parse(reply))
    }

    socket.on('message', onMessage)
    socket.send(packet, PORT, HOST, (error) => {
      if (error) {
        clearTimeout(timer)
        socket.off('message', onMessage)
        reject(error)
      }
    })
  })
}

/** coturn's REST scheme, the same as the engine mints. */
function credentialFor(identifier, ttlSeconds) {
  const username = `${Math.floor(Date.now() / 1000) + ttlSeconds}:${identifier}`
  return { username, password: createHmac('sha1', SECRET).update(username).digest('base64') }
}

/**
 * An Allocate, which is the request that asks for a relayed address.
 *
 * Two round trips, always: the first is sent unsigned and is *expected* to be
 * refused with 401 and a nonce, and the second is signed with it. That is how
 * long-term credentials work, and a check that treated the 401 as a failure would
 * report a working relay as broken.
 */
async function allocate(credential) {
  /*
   * Its own socket, every time.
   *
   * coturn keys an allocation by the five-tuple, so a second Allocate from the
   * same local port is answered 437 Allocation Mismatch rather than being
   * authenticated at all — which made the expired-credential check pass for the
   * wrong reason until a real coturn said 437 instead of 401.
   */
  const socket = createSocket('udp4')
  try {
    return await allocateOn(socket, credential)
  } finally {
    socket.close()
  }
}

async function allocateOn(socket, credential) {
  const first = randomBytes(12)
  const challenge = await exchange(
    socket,
    message({
      method: METHOD.allocate,
      transactionId: first,
      attributes: [attribute(ATTR.requestedTransport, Buffer.from([17, 0, 0, 0]))],
    }),
    first,
  )

  const nonce = challenge.attributes.get(ATTR.nonce)
  const realm = challenge.attributes.get(ATTR.realm) ?? Buffer.from(REALM)
  if (!nonce) {
    throw new Error(`expected a 401 with a nonce, got ${errorCode(challenge.attributes) ?? 'success'}`)
  }

  // The long-term credential key, which is md5 of the three joined by colons.
  // Not a password hash — it is the key the message integrity HMAC is taken under,
  // and it is what the RFC specifies.
  const signingKey = createHash('md5')
    .update(`${credential.username}:${realm.toString()}:${credential.password}`)
    .digest()

  const second = randomBytes(12)
  return exchange(
    socket,
    message({
      method: METHOD.allocate,
      transactionId: second,
      attributes: [
        attribute(ATTR.requestedTransport, Buffer.from([17, 0, 0, 0])),
        attribute(ATTR.username, Buffer.from(credential.username)),
        attribute(ATTR.realm, realm),
        attribute(ATTR.nonce, nonce),
      ],
      key: signingKey,
    }),
    second,
  )
}

async function main() {
  const socket = createSocket('udp4')
  const failures = []

  try {
    // 1. Is anything there at all.
    const transactionId = randomBytes(12)
    const binding = await exchange(
      socket,
      message({ method: METHOD.binding, transactionId }),
      transactionId,
    )
    const mapped =
      binding.attributes.get(ATTR.xorMappedAddress) ?? binding.attributes.get(ATTR.mappedAddress)
    if (!binding.isSuccess || !mapped) failures.push('STUN Binding was not answered.')
    else console.log(`ok   STUN answers at ${HOST}:${PORT}`)

    // 2. Does coturn compute the same HMAC we do, and hand out a relay.
    const good = await allocate(credentialFor('turn-check:live', 600))
    if (good.isSuccess && good.attributes.has(ATTR.xorRelayedAddress)) {
      console.log('ok   a minted credential allocates a relayed address')
    } else {
      failures.push(
        `A live credential was refused (${errorCode(good.attributes) ?? 'no error code'}). ` +
          'The secret here and the one coturn was started with are probably different.',
      )
    }

    // 3. The one that matters: a stale credential is no use to anybody.
    const stale = await allocate(credentialFor('turn-check:stale', -600))
    if (stale.isError && [401, 438].includes(errorCode(stale.attributes) ?? 0)) {
      console.log('ok   an expired credential is refused')
    } else {
      failures.push(
        'An expired credential was NOT refused. The relay is open to anybody who has ever ' +
          'been in a call, which is the way a TURN server gets taken over.',
      )
    }
  } catch (cause) {
    failures.push(cause instanceof Error ? cause.message : String(cause))
  } finally {
    socket.close()
  }

  if (failures.length > 0) {
    console.error('\nThe relay check failed:')
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exitCode = 1
    return
  }

  console.log('\nThe relay works, and its credentials expire.')
}

await main()
