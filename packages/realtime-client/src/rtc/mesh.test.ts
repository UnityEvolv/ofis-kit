import type { SignalMessage } from '@unityevolv/ofiskit-realtime-core/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DATA_CHANNEL_MAX_BYTES, type JoinOptions, type Signaller } from './adapter.js'
import { dataChannelId, meshAdapter, utf8Length } from './mesh.js'

/**
 * The mesh's data channels, tested without a browser.
 *
 * A fake peer connection records every channel made on it, and a fake channel
 * records what was sent and lets the test deliver what arrives. What matters is
 * the bookkeeping — which connection carries which channel, with which id, and
 * who a message is said to be from — and none of that needs real WebRTC to check.
 */

class FakeChannel {
  readyState: RTCDataChannelState = 'open'
  sent: string[] = []
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(
    readonly label: string,
    readonly init: RTCDataChannelInit,
  ) {}

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 'closed'
  }

  /** What the far end sending something looks like from here. */
  deliver(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

class FakeConnection {
  static made: FakeConnection[] = []

  channels: FakeChannel[] = []
  connectionState: RTCPeerConnectionState = 'new'
  signalingState: RTCSignalingState = 'stable'
  localDescription: RTCSessionDescription | null = null
  remoteDescription: RTCSessionDescription | null = null
  onicecandidate: unknown = null
  onnegotiationneeded: unknown = null
  ontrack: unknown = null
  onconnectionstatechange: unknown = null

  constructor() {
    FakeConnection.made.push(this)
  }

  createDataChannel(label: string, init: RTCDataChannelInit) {
    if (this.connectionState === 'closed') throw new Error('InvalidStateError')
    const channel = new FakeChannel(label, init)
    this.channels.push(channel)
    return channel
  }

  channel(label: string): FakeChannel {
    const found = this.channels.find((one) => one.label === label)
    if (!found) throw new Error(`no channel ${label}`)
    return found
  }

  close() {
    this.connectionState = 'closed'
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = { ...description, toJSON: () => description } as RTCSessionDescription
  }

  async setLocalDescription() {
    const description = { type: 'answer', sdp: 'o=- 1 1 IN IP4 0.0.0.0' } as const
    this.localDescription = { ...description, toJSON: () => description } as RTCSessionDescription
  }

  async addIceCandidate() {}

  async getStats() {
    return new Map()
  }
}

function fakeSignaller() {
  let receive: ((message: SignalMessage & { from: string }) => void) | null = null
  const signaller: Signaller = {
    send: () => {},
    receive(handler) {
      receive = handler
      return () => {
        receive = null
      }
    },
  }
  return {
    signaller,
    /** A message from another leg, arriving over signalling. */
    arrive(message: SignalMessage & { from: string }) {
      receive?.(message)
    },
  }
}

const joinOptions = (deviceIds: string[]): JoinOptions => ({
  callId: 'call-1',
  deviceId: 'device-self',
  credentials: null,
  iceServers: [],
  participants: deviceIds.map((deviceId) => ({
    deviceId,
    userId: `user-${deviceId}`,
    displayName: '',
  })),
  audio: false,
  video: false,
})

const connectionTo = (index: number): FakeConnection => {
  const connection = FakeConnection.made[index]
  if (!connection) throw new Error(`no connection ${index}`)
  return connection
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeConnection.made = []
  vi.stubGlobal('RTCPeerConnection', FakeConnection)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a data channel on the mesh', () => {
  it('is carried by every connection, negotiated, on an id both ends derive from the label', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    await adapter.join(joinOptions(['device-a', 'device-b']))

    adapter.openDataChannel!('input', { ordered: false, maxRetransmits: 0 })

    for (const connection of FakeConnection.made) {
      const channel = connection.channel('input')
      expect(channel.init).toEqual({
        negotiated: true,
        id: dataChannelId('input'),
        ordered: false,
        maxRetransmits: 0,
      })
    }
    // Same label, same id, on whichever device computes it.
    expect(dataChannelId('input')).toBe(dataChannelId('input'))
    expect(dataChannelId('input')).not.toBe(dataChannelId('cursor'))
    expect(dataChannelId('input')).toBeLessThan(1024)

    await adapter.leave()
  })

  it('is ordered and reliable unless told otherwise', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    await adapter.join(joinOptions(['device-a']))

    adapter.openDataChannel!('input')

    expect(connectionTo(0).channel('input').init).toEqual({
      negotiated: true,
      id: dataChannelId('input'),
      ordered: true,
    })
    await adapter.leave()
  })

  it('is attached to a connection made after it was opened, before that connection offers', async () => {
    const { signaller, arrive } = fakeSignaller()
    const adapter = meshAdapter(signaller)
    // Opened before anybody is in the call at all.
    const channel = adapter.openDataChannel!('input')
    await adapter.join(joinOptions([]))
    expect(FakeConnection.made).toHaveLength(0)

    // Somebody arrives, and the first we hear of them is their offer.
    arrive({
      from: 'device-late',
      to: 'device-self',
      type: 'offer',
      payload: { type: 'offer', sdp: 'o=- 7 1 IN IP4 0.0.0.0' },
    })
    await vi.advanceTimersByTimeAsync(0)

    const late = connectionTo(0)
    expect(late.channel('input').init).toMatchObject({
      negotiated: true,
      id: dataChannelId('input'),
    })

    channel.send('hello')
    expect(late.channel('input').sent).toEqual(['hello'])
    await adapter.leave()
  })

  it('says which device a message came from', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    await adapter.join(joinOptions(['device-a', 'device-b']))
    const channel = adapter.openDataChannel!('input')

    const received: Array<[string, string]> = []
    channel.onMessage((data, from) => received.push([data, from]))

    connectionTo(1).channel('input').deliver('from b')
    connectionTo(0).channel('input').deliver('from a')

    expect(received).toEqual([
      ['from b', 'device-b'],
      ['from a', 'device-a'],
    ])
    await adapter.leave()
  })

  it('stops delivering to a handler once it unsubscribes', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    await adapter.join(joinOptions(['device-a']))
    const channel = adapter.openDataChannel!('input')

    const received: string[] = []
    const stop = channel.onMessage((data) => received.push(data))
    connectionTo(0).channel('input').deliver('one')
    stop()
    connectionTo(0).channel('input').deliver('two')

    expect(received).toEqual(['one'])
    await adapter.leave()
  })

  it('sends to one device when told which, and to everyone when not', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    await adapter.join(joinOptions(['device-a', 'device-b', 'device-c']))
    const channel = adapter.openDataChannel!('input')

    channel.send('just b', 'device-b')
    channel.send('everyone')

    expect(connectionTo(0).channel('input').sent).toEqual(['everyone'])
    expect(connectionTo(1).channel('input').sent).toEqual(['just b', 'everyone'])
    expect(connectionTo(2).channel('input').sent).toEqual(['everyone'])
    await adapter.leave()
  })

  it('skips a device that is not connected yet, or not in the call', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    await adapter.join(joinOptions(['device-a', 'device-b']))
    const channel = adapter.openDataChannel!('input')
    connectionTo(0).channel('input').readyState = 'connecting'

    expect(() => channel.send('to a', 'device-a')).not.toThrow()
    expect(() => channel.send('to nobody', 'device-gone')).not.toThrow()
    channel.send('everyone')

    expect(connectionTo(0).channel('input').sent).toEqual([])
    expect(connectionTo(1).channel('input').sent).toEqual(['everyone'])
    await adapter.leave()
  })

  it('closes a leg’s end when that leg leaves, and does not come back for it', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    await adapter.join(joinOptions(['device-a', 'device-b']))
    const channel = adapter.openDataChannel!('input')

    adapter.removeParticipant!('device-a')

    expect(connectionTo(0).channel('input').readyState).toBe('closed')
    expect(connectionTo(1).channel('input').readyState).toBe('open')
    channel.send('still here')
    expect(connectionTo(0).channel('input').sent).toEqual([])
    expect(connectionTo(1).channel('input').sent).toEqual(['still here'])
    await adapter.leave()
  })

  it('closes everywhere when the call ends, and a closed channel sends and hears nothing', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    await adapter.join(joinOptions(['device-a', 'device-b']))
    const channel = adapter.openDataChannel!('input')
    const received: string[] = []
    channel.onMessage((data) => received.push(data))

    await adapter.leave()

    for (const connection of FakeConnection.made) {
      expect(connection.channel('input').readyState).toBe('closed')
    }
    channel.send('too late')
    connectionTo(0).channel('input').deliver('too late')
    expect(connectionTo(0).channel('input').sent).toEqual([])
    expect(received).toEqual([])
    // And the label is free for the next call.
    expect(() => adapter.openDataChannel!('input').close()).not.toThrow()
  })

  it('closes on request, twice without harm, and frees the label', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    await adapter.join(joinOptions(['device-a']))
    const channel = adapter.openDataChannel!('input')

    channel.close()
    channel.close()

    expect(connectionTo(0).channel('input').readyState).toBe('closed')
    expect(() => adapter.openDataChannel!('input')).not.toThrow()
    await adapter.leave()
  })

  it('refuses the same label twice while it is open', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    adapter.openDataChannel!('input')

    expect(() => adapter.openDataChannel!('input')).toThrow(/already open/)
    expect(() => adapter.openDataChannel!('')).toThrow(TypeError)
  })

  it('refuses a message over the size cap, and ignores one arriving over it', async () => {
    const adapter = meshAdapter(fakeSignaller().signaller)
    await adapter.join(joinOptions(['device-a']))
    const channel = adapter.openDataChannel!('input')
    const received: string[] = []
    channel.onMessage((data) => received.push(data))

    const largest = 'x'.repeat(DATA_CHANNEL_MAX_BYTES)
    channel.send(largest)
    expect(() => channel.send(`${largest}x`)).toThrow(RangeError)
    // Counted in bytes, not characters: each of these is three.
    expect(() => channel.send('€'.repeat(DATA_CHANNEL_MAX_BYTES / 2))).toThrow(RangeError)
    expect(connectionTo(0).channel('input').sent).toEqual([largest])

    connectionTo(0).channel('input').deliver(`${largest}x`)
    connectionTo(0).channel('input').deliver(new ArrayBuffer(4))
    expect(received).toEqual([])
    await adapter.leave()
  })
})

describe('the size of a message', () => {
  it('is counted in UTF-8 bytes', () => {
    expect(utf8Length('')).toBe(0)
    expect(utf8Length('abc')).toBe(3)
    expect(utf8Length('é')).toBe(2)
    expect(utf8Length('€')).toBe(3)
    expect(utf8Length('😀')).toBe(4)
    for (const text of ['mixed é € 😀 text', '\ud800 lone surrogate']) {
      expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length)
    }
  })
})
