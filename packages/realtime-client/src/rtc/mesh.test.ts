import type { SignalMessage } from '@unityevolv/ofiskit-realtime-core/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DATA_CHANNEL_MAX_BYTES,
  type JoinOptions,
  type RtcEvent,
  type Signaller,
} from './adapter.js'
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

  /** What this connection is sending, by sender. */
  senders: FakeSender[] = []

  addTrack(track: FakeTrack, stream: FakeStream) {
    const sender = new FakeSender(track, stream)
    this.senders.push(sender)
    return sender
  }

  removeTrack(sender: FakeSender) {
    this.senders = this.senders.filter((one) => one !== sender)
  }

  /** A remote track arriving, as the browser announces it. */
  receive(track: FakeTrack, stream: FakeStream) {
    ;(this.ontrack as (event: { track: FakeTrack; streams: FakeStream[] }) => void)({
      track,
      streams: [stream],
    })
  }
}

/** Enough of a MediaStreamTrack to be enabled, stopped, muted and replaced. */
class FakeTrack {
  enabled = true
  readyState: MediaStreamTrackState = 'live'
  onended: (() => void) | null = null
  onmute: (() => void) | null = null
  onunmute: (() => void) | null = null

  constructor(readonly kind: 'audio' | 'video') {}

  stop() {
    this.readyState = 'ended'
  }
}

class FakeStream {
  onremovetrack: (() => void) | null = null

  constructor(
    readonly id: string,
    private tracks: FakeTrack[],
  ) {}

  getTracks() {
    return [...this.tracks]
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio')
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video')
  }

  /** What the far side calling removeTrack looks like from here. */
  lose(track: FakeTrack) {
    this.tracks = this.tracks.filter((one) => one !== track)
    this.onremovetrack?.()
  }
}

class FakeSender {
  constructor(
    public track: FakeTrack,
    readonly stream: FakeStream,
  ) {}

  getParameters() {
    return {} as RTCRtpSendParameters
  }
  async setParameters() {}
  async replaceTrack(track: FakeTrack) {
    this.track = track
  }
}

function fakeSignaller() {
  let receive: ((message: SignalMessage & { from: string }) => void) | null = null
  const sent: SignalMessage[] = []
  const signaller: Signaller = {
    send: (message) => {
      sent.push(message)
    },
    receive(handler) {
      receive = handler
      return () => {
        receive = null
      }
    },
  }
  return {
    signaller,
    /** Everything this side sent, in order. */
    sent,
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

/**
 * Local media, faked: getUserMedia hands back a stream per request, and the audio
 * context records which stream the speaking indicator is listening to.
 */
function stubMedia() {
  let counter = 0
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    counter += 1
    return new FakeStream(`local-${counter}`, [
      new FakeTrack(constraints.audio ? 'audio' : 'video'),
    ])
  })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })

  const listenedTo: FakeStream[] = []
  class FakeAudioContext {
    createAnalyser() {
      return { fftSize: 0, getByteTimeDomainData() {} }
    }
    createMediaStreamSource(stream: FakeStream) {
      listenedTo.push(stream)
      return { connect() {} }
    }
    async close() {}
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)

  return { getUserMedia, listenedTo }
}

/** One peer in the call, and everything the adapter told the app about it. */
async function withPeer() {
  const { signaller, arrive, sent } = fakeSignaller()
  const adapter = meshAdapter(signaller)
  const events: RtcEvent[] = []
  adapter.on((event) => events.push(event))
  await adapter.join(joinOptions(['device-a']))

  /** The last thing said about one of the peer's video slots. */
  const latest = (source: 'camera' | 'screen') =>
    events
      .filter(
        (event): event is Extract<RtcEvent, { type: 'track' | 'track.ended' }> =>
          (event.type === 'track' || event.type === 'track.ended') && event.source === source,
      )
      .at(-1)

  return { adapter, arrive, sent, events, latest, connection: connectionTo(0) }
}

describe('a remote video that stops', () => {
  it('comes off screen when the far side takes the track away, which mutes it here', async () => {
    const { adapter, latest, connection } = await withPeer()
    const track = new FakeTrack('video')
    connection.receive(track, new FakeStream('their-camera', [track]))
    expect(latest('camera')).toMatchObject({ type: 'track', deviceId: 'device-a' })

    // removeTrack never ends a track on the receiving side. Waiting for `ended`
    // is waiting for ever, with the last frame on screen.
    track.onmute?.()
    expect(latest('camera')).toEqual({
      type: 'track.ended',
      deviceId: 'device-a',
      source: 'camera',
    })

    // A sender that only paused comes back the same way.
    track.onunmute?.()
    expect(latest('camera')).toMatchObject({ type: 'track' })
    await adapter.leave()
  })

  it('comes off screen when its stream loses its last video track', async () => {
    const { adapter, latest, connection } = await withPeer()
    const track = new FakeTrack('video')
    const stream = new FakeStream('their-camera', [track])
    connection.receive(track, stream)

    stream.lose(track)

    expect(latest('camera')).toMatchObject({ type: 'track.ended' })
    await adapter.leave()
  })

  it('comes off screen, and stays off, when the peer says its camera stopped', async () => {
    const { adapter, arrive, latest, connection } = await withPeer()
    const track = new FakeTrack('video')
    connection.receive(track, new FakeStream('their-camera', [track]))

    arrive({
      from: 'device-a',
      to: 'device-self',
      type: 'camera',
      payload: { streamId: 'their-camera', active: false },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(latest('camera')).toMatchObject({ type: 'track.ended' })

    // A stray unmute on the way out does not bring a finished camera back.
    track.onunmute?.()
    expect(latest('camera')).toMatchObject({ type: 'track.ended' })
    await adapter.leave()
  })

  it('does not put a stopped share into the face tile', async () => {
    const { adapter, arrive, events, latest, connection } = await withPeer()
    arrive({
      from: 'device-a',
      to: 'device-self',
      type: 'share',
      payload: { streamId: 'their-screen', active: true },
    })
    await vi.advanceTimersByTimeAsync(0)
    const track = new FakeTrack('video')
    connection.receive(track, new FakeStream('their-screen', [track]))
    expect(latest('screen')).toMatchObject({ type: 'track' })

    arrive({
      from: 'device-a',
      to: 'device-self',
      type: 'share',
      payload: { streamId: null, active: false },
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(latest('screen')).toMatchObject({ type: 'track.ended' })
    // The spreadsheet is not anybody's face.
    const asCamera = events.filter(
      (event) =>
        event.type === 'track' &&
        event.source === 'camera' &&
        (event.stream as unknown as FakeStream).id === 'their-screen',
    )
    expect(asCamera).toEqual([])
    await adapter.leave()
  })
})

describe('turning our own camera off', () => {
  it('tells every peer which stream stopped, before the track is taken away', async () => {
    stubMedia()
    const { adapter, sent, connection } = await withPeer()
    await adapter.setCamera(true)
    expect(connection.senders).toHaveLength(1)
    const cameraId = connection.senders[0]!.stream.id

    await adapter.setCamera(false)

    expect(sent).toContainEqual({
      to: 'device-a',
      type: 'camera',
      payload: { streamId: cameraId, active: false },
    })
    expect(connection.senders).toHaveLength(0)
    await adapter.leave()
  })
})

describe('switching microphone', () => {
  it('keeps a muted microphone muted, and the speaking indicator on the new one', async () => {
    const { getUserMedia, listenedTo } = stubMedia()
    const { signaller } = fakeSignaller()
    const adapter = meshAdapter(signaller)
    await adapter.join({ ...joinOptions(['device-a']), audio: true })
    await adapter.setMicrophone(false)

    await adapter.useDevices({ audioDeviceId: 'headset' })

    const sender = connectionTo(0).senders[0]!
    // A new track starts enabled; this one must not, or switching headset while
    // muted opens the microphone to the room.
    expect(sender.track.enabled).toBe(false)
    expect(listenedTo.at(-1)?.getAudioTracks()[0]).toBe(sender.track)
    // Asked for with the same processing as the first one.
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: expect.objectContaining({
        deviceId: { exact: 'headset' },
        echoCancellation: true,
      }),
    })
    await adapter.leave()
  })
})
