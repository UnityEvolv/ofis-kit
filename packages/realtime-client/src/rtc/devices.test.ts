import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeMediaError } from './mesh.js'
import {
  labelFor,
  listDevices,
  memoryDeviceStorage,
  requestPermission,
  stillAvailable,
  watchDevices,
  type Devices,
} from './devices.js'

/**
 * Picking a device, and coping when the browser says no.
 *
 * Almost every test here is about a failure, because that is where the value is.
 * Choosing from a list is easy; telling somebody the difference between "you
 * denied permission" and "something else is holding your camera" is what stops a
 * support ticket, and the browser reports the two almost identically.
 */

function device(kind: MediaDeviceKind, deviceId: string, label = ''): MediaDeviceInfo {
  return {
    kind,
    deviceId,
    label,
    groupId: 'group',
    toJSON: () => ({}),
  } as MediaDeviceInfo
}

/** A fake `navigator.mediaDevices`, which jsdom does not provide. */
function media(options: {
  devices?: MediaDeviceInfo[]
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
}) {
  const listeners = new Set<() => void>()
  const fake = {
    enumerateDevices: async () => options.devices ?? [],
    getUserMedia: options.getUserMedia ?? (async () => stream([track('audio')])),
    addEventListener: (_: string, handler: () => void) => listeners.add(handler),
    removeEventListener: (_: string, handler: () => void) => listeners.delete(handler),
  }

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: fake },
  })

  return { fire: () => listeners.forEach((handler) => handler()), listeners }
}

function track(kind: 'audio' | 'video', state: Partial<MediaStreamTrack> = {}): MediaStreamTrack {
  return {
    kind,
    readyState: 'live',
    muted: false,
    stop: vi.fn(),
    ...state,
  } as MediaStreamTrack
}

function stream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((one) => one.kind === 'audio'),
    getVideoTracks: () => tracks.filter((one) => one.kind === 'video'),
  } as MediaStream
}

const devices = (overrides: Partial<Devices> = {}): Devices => ({
  microphones: [],
  cameras: [],
  speakers: [],
  ...overrides,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('what is plugged in', () => {
  it('sorts the devices into microphones, cameras and speakers', async () => {
    media({
      devices: [
        device('audioinput', 'mic-1', 'Headset'),
        device('videoinput', 'cam-1', 'FaceTime HD'),
        device('audiooutput', 'out-1', 'Speakers'),
        device('audioinput', 'mic-2', 'Built-in'),
      ],
    })

    const found = await listDevices()
    expect(found.microphones.map((one) => one.deviceId)).toEqual(['mic-1', 'mic-2'])
    expect(found.cameras).toHaveLength(1)
    expect(found.speakers).toHaveLength(1)
  })

  it('names a device that has lost its label, by kind and position', () => {
    // Labels are empty until permission has been granted once, which is why the
    // panel asks first — but a list of blanks is worse than a numbered one.
    expect(labelFor(device('audioinput', 'a'), 0)).toBe('Microphone 1')
    expect(labelFor(device('videoinput', 'b'), 1)).toBe('Camera 2')
    expect(labelFor(device('audiooutput', 'c'), 0)).toBe('Speaker 1')
    expect(labelFor(device('audioinput', 'd', 'Jabra'), 3)).toBe('Jabra')
  })
})

describe('asking for permission', () => {
  it('returns the stream when the browser says yes', async () => {
    const live = stream([track('audio')])
    media({ getUserMedia: async () => live })

    const outcome = await requestPermission({ audio: true, video: false })
    expect(outcome).toMatchObject({ granted: true })
    expect(outcome.stream).toBe(live)
  })

  it('says exactly how to fix a denial, because the browser does not', async () => {
    const denied = new Error('Permission denied')
    denied.name = 'NotAllowedError'
    media({ getUserMedia: async () => Promise.reject(denied) })

    const outcome = await requestPermission({ audio: true, video: true })
    expect(outcome.granted).toBe(false)
    // The padlock, by name, because "permission denied" tells nobody what to do.
    expect(outcome.problem).toMatch(/padlock in the address bar/i)
  })

  it('tells a silent black stream apart from a denial', async () => {
    /*
     * The awkward case this exists for.
     *
     * On some platforms a camera held by another application *grants* permission
     * and hands back a stream with nothing in it. That looks identical to a
     * working camera until somebody says they cannot see you, so it is checked
     * for explicitly and reported as the different problem it is.
     */
    const dead = track('video', { readyState: 'ended' })
    media({ getUserMedia: async () => stream([dead]) })

    const outcome = await requestPermission({ audio: false, video: true })

    expect(outcome.granted).toBe(true)
    expect(outcome.inUseElsewhere).toBe(true)
    expect(outcome.problem).toMatch(/open in another app/i)
    // And the dead stream is released rather than left holding the device.
    expect(dead.stop).toHaveBeenCalled()
  })

  it('does not call a half-live stream busy', async () => {
    // A microphone that works and a camera that does not is a camera problem, not
    // a reason to refuse the call.
    media({
      getUserMedia: async () => stream([track('audio'), track('video', { readyState: 'ended' })]),
    })

    const outcome = await requestPermission({ audio: true, video: true })
    expect(outcome.inUseElsewhere).toBeUndefined()
    expect(outcome.granted).toBe(true)
  })

  it('asks for the chosen device, with the browser’s own cleanup on', async () => {
    let asked: MediaStreamConstraints | undefined
    media({
      getUserMedia: async (constraints) => {
        asked = constraints
        return stream([track('audio')])
      },
    })

    await requestPermission({ audio: true, video: true }, { audioDeviceId: 'mic-1' })

    // Echo cancellation and noise suppression are what make a laptop in a room
    // with three other people usable at all, and the browser gives them free.
    expect(asked?.audio).toMatchObject({
      deviceId: { exact: 'mic-1' },
      echoCancellation: true,
      noiseSuppression: true,
    })
  })
})

describe('when the hardware changes underneath', () => {
  it('reports the new list when something is plugged in or pulled out', async () => {
    const fake = media({ devices: [device('audioinput', 'built-in', 'Built-in')] })
    const seen: Devices[] = []

    const stop = watchDevices((next) => seen.push(next))
    fake.fire()
    await vi.waitFor(() => expect(seen).toHaveLength(1))

    expect(seen[0]?.microphones[0]?.deviceId).toBe('built-in')
    stop()
    expect(fake.listeners.size).toBe(0)
  })

  it('drops a remembered choice whose device has gone', () => {
    // A headset that has been unplugged should fall back to the operating
    // system's default, not fail with a constraint error nobody can interpret.
    const choice = { audioDeviceId: 'headset', videoDeviceId: 'webcam', speakerDeviceId: 'out' }
    const surviving = stillAvailable(
      choice,
      devices({ cameras: [device('videoinput', 'webcam')] }),
    )

    expect(surviving).toEqual({ videoDeviceId: 'webcam' })
  })

  it('keeps a choice that is still there', () => {
    const choice = { audioDeviceId: 'headset' }
    expect(
      stillAvailable(choice, devices({ microphones: [device('audioinput', 'headset')] })),
    ).toEqual(choice)
  })
})

describe('remembering a choice', () => {
  it('reads back what was written', () => {
    // Injected rather than reached for, because this package runs on a phone and
    // localStorage does not exist there. The web app passes one over localStorage.
    const storage = memoryDeviceStorage()
    storage.write({ audioDeviceId: 'headset' })
    expect(storage.read()).toEqual({ audioDeviceId: 'headset' })
  })
})

describe('what a media failure is called', () => {
  it('names the cause and the fix for each one worth telling apart', () => {
    const cases: Array<[string, RegExp]> = [
      ['NotAllowedError', /padlock/i],
      ['NotReadableError', /another app is using/i],
      ['NotFoundError', /no camera was found/i],
      ['OverconstrainedError', /no longer available/i],
    ]

    for (const [name, matcher] of cases) {
      const cause = new Error('x')
      cause.name = name
      expect(describeMediaError(cause, 'camera')).toMatch(matcher)
    }
  })

  it('still says something useful for a failure nobody anticipated', () => {
    expect(describeMediaError(new Error('who knows'), 'microphone')).toMatch(
      /microphone could not be started/i,
    )
  })
})
