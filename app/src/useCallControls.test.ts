import type {
  OfficeSnapshot,
  OfisClient,
  PublicPresence,
  ScreenSource,
} from '@unityevolv/ofiskit-realtime-client'
import { fromSnapshot } from '@unityevolv/ofiskit-realtime-client'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCallControls } from './useCallControls.js'

/**
 * What pressing share actually does.
 *
 * Three different acts behind one button, which is the reason this logic is in one
 * place: on the web in an empty call it opens the browser's picker and nothing else
 * happens; with somebody else already sharing it asks first, because a call has one
 * screen slot and taking it ends their share; and inside a desktop shell it has to
 * draw the list of windows itself, because that browser has no picker.
 */

function device(overrides: Partial<PublicPresence['devices'][number]> = {}) {
  return {
    deviceId: 'ada-laptop',
    kind: 'web' as const,
    inCall: true,
    muted: false,
    cameraOn: false,
    sharing: false,
    speaking: false,
    lastSpokeAt: null,
    handRaisedAt: null,
    ...overrides,
  }
}

function person(
  userId: string,
  displayName: string,
  devices: PublicPresence['devices'],
): PublicPresence {
  return {
    userId,
    displayName,
    roomId: 'studio',
    devices,
    status: 'in_call',
    arrivedAt: '2026-01-01T09:00:00.000Z',
  }
}

/** The office as this device sees it: you and Grace, both in the studio call. */
function office(options: { sharing?: { userId: string; deviceId: string }; yours?: boolean } = {}) {
  const snapshot: OfficeSnapshot = {
    officeId: 'office',
    seq: 1,
    people: [
      person('ada', 'Ada', [device({ sharing: options.yours ?? false })]),
      person('grace', 'Grace', [
        device({
          deviceId: 'grace-laptop',
          sharing: options.sharing?.deviceId === 'grace-laptop',
        }),
      ]),
    ],
    locks: [],
    calls: [
      {
        roomId: 'studio',
        provider: 'builtin',
        startedAt: '2026-01-01T09:00:00.000Z',
        participants: [
          { userId: 'ada', deviceId: 'ada-laptop' },
          { userId: 'grace', deviceId: 'grace-laptop' },
        ],
        limit: 4,
        sharing: options.sharing
          ? { ...options.sharing, startedAt: '2026-01-01T09:05:00.000Z' }
          : null,
      },
    ],
    you: { userId: 'ada', deviceId: 'ada-laptop', manual: null },
  }

  return fromSnapshot(snapshot)
}

function fakeClient() {
  const rtc = {
    startScreenShare: vi.fn(async () => true),
    stopScreenShare: vi.fn(async () => {}),
    setMicrophone: vi.fn(async () => {}),
    setCamera: vi.fn(async () => {}),
  }

  const client = {
    rtc,
    joinCall: vi.fn(async () => ({ ok: true }) as never),
    leaveCall: vi.fn(async () => ({ ok: true }) as never),
    raiseHand: vi.fn(async () => ({ ok: true }) as never),
    react: vi.fn(async () => ({ ok: true }) as never),
  } as unknown as OfisClient

  return { client, rtc }
}

const sources = (list: ScreenSource[]) => ({ list: vi.fn(async () => list) })

function controls(options: {
  state?: ReturnType<typeof office>
  screenSources?: { list: () => Promise<ScreenSource[]> } | null
} = {}) {
  const { client, rtc } = fakeClient()
  const hook = renderHook(() =>
    useCallControls(client, options.state ?? office(), {
      available: true,
      screenSources: options.screenSources ?? null,
    }),
  )

  return { hook, client, rtc }
}

beforeEach(() => {
  localStorage.clear()
})

describe('pressing share', () => {
  it('opens the browser’s own picker when nobody else is sharing', async () => {
    const { hook, rtc } = controls()

    act(() => hook.result.current.toggleShare())

    // No options at all: the browser picker is the one people know, and it is the
    // only one that can offer a single tab.
    expect(rtc.startScreenShare).toHaveBeenCalledWith(undefined)
    expect(hook.result.current.asking).toBeNull()
  })

  it('stops your own share instead of starting a second one', async () => {
    const { hook, rtc } = controls({ state: office({ yours: true }) })

    act(() => hook.result.current.toggleShare())

    expect(rtc.stopScreenShare).toHaveBeenCalled()
    expect(rtc.startScreenShare).not.toHaveBeenCalled()
  })

  it('joins the call first for somebody who is only in the room', async () => {
    const outside = office()
    outside.people.set('ada', person('ada', 'Ada', [device({ inCall: false })]))
    const { hook, client, rtc } = controls({ state: outside })

    act(() => hook.result.current.toggleShare())

    // Sharing is joining, like the microphone and the camera. Audio off: somebody
    // sharing a screen has not asked to be heard yet.
    expect(client.joinCall).toHaveBeenCalledWith({ audio: false, video: false })
    await waitFor(() => expect(rtc.startScreenShare).toHaveBeenCalled())
  })
})

describe('somebody else is already sharing', () => {
  const taken = () => office({ sharing: { userId: 'grace', deviceId: 'grace-laptop' } })

  it('asks before ending their share, and starts nothing yet', async () => {
    const { hook, rtc } = controls({ state: taken() })

    act(() => hook.result.current.toggleShare())

    expect(hook.result.current.asking).toEqual({ kind: 'take-over', sharerName: 'Grace' })
    // Nothing has happened to Grace: a share that vanished while the person who
    // took it was still reading a dialog would be the worst of both.
    expect(rtc.startScreenShare).not.toHaveBeenCalled()
  })

  it('shares once the question is answered', async () => {
    const { hook, rtc } = controls({ state: taken() })

    act(() => hook.result.current.toggleShare())
    act(() => hook.result.current.confirmTakeOver())

    expect(rtc.startScreenShare).toHaveBeenCalled()
    expect(hook.result.current.asking).toBeNull()
  })

  it('leaves everything alone when the answer is no', async () => {
    const { hook, rtc } = controls({ state: taken() })

    act(() => hook.result.current.toggleShare())
    act(() => hook.result.current.cancelShare())

    expect(hook.result.current.asking).toBeNull()
    expect(rtc.startScreenShare).not.toHaveBeenCalled()
    expect(rtc.stopScreenShare).not.toHaveBeenCalled()
  })

  it('names them on the control, so it never lies about what it would do', () => {
    const { hook } = controls({ state: taken() })

    expect(hook.result.current.sharedByOther).toBe('Grace')
  })
})

describe('inside a desktop shell', () => {
  const windows = [
    { id: 'screen:1', name: 'Screen 1', kind: 'screen' as const },
    { id: 'window:2', name: 'Spreadsheet', kind: 'window' as const },
  ]

  it('asks the host for its list instead of the browser', async () => {
    const provider = sources(windows)
    const { hook, rtc } = controls({ screenSources: provider })

    act(() => hook.result.current.toggleShare())

    await waitFor(() =>
      expect(hook.result.current.asking).toEqual({ kind: 'sources', list: windows }),
    )
    // Nothing is captured until something has been chosen.
    expect(rtc.startScreenShare).not.toHaveBeenCalled()
  })

  it('captures exactly the source that was chosen', async () => {
    const { hook, rtc } = controls({ screenSources: sources(windows) })

    act(() => hook.result.current.toggleShare())
    await waitFor(() => expect(hook.result.current.asking).not.toBeNull())
    act(() => hook.result.current.pickSource('window:2'))

    expect(rtc.startScreenShare).toHaveBeenCalledWith({ sourceId: 'window:2' })
  })

  it('shows the list rather than failing when the host cannot produce one', async () => {
    // An empty list is a dialog that says so and offers a way out, which is better
    // than a button that appears to do nothing.
    const provider = { list: vi.fn(async () => Promise.reject(new Error('no capture'))) }
    const { hook } = controls({ screenSources: provider })

    act(() => hook.result.current.toggleShare())

    await waitFor(() => expect(hook.result.current.asking).toEqual({ kind: 'sources', list: [] }))
  })

  it('asks the take-over question first, and the source list second', async () => {
    const { hook, rtc } = controls({
      state: office({ sharing: { userId: 'grace', deviceId: 'grace-laptop' } }),
      screenSources: sources(windows),
    })

    act(() => hook.result.current.toggleShare())
    expect(hook.result.current.asking).toMatchObject({ kind: 'take-over' })

    act(() => hook.result.current.confirmTakeOver())

    await waitFor(() => expect(hook.result.current.asking).toMatchObject({ kind: 'sources' }))
    expect(rtc.startScreenShare).not.toHaveBeenCalled()
  })
})
