import type { OfficeState, OfisClient, ScreenSource } from '@unityevolv/ofiskit-realtime-client'
import { fromSnapshot } from '@unityevolv/ofiskit-realtime-client'
import { render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  ScreenSourcePicker,
  ShareStage,
  SharingBanner,
  TakeOverDialog,
  describeShare,
} from './Share.js'
import type { CallMedia } from './useCall.js'
import { useShare, useShareView } from './useShare.js'

/**
 * Showing a screen.
 *
 * The parts worth testing are the ones that are about somebody else's attention: a
 * share takes over everybody's view, so the view has to be given back; it takes over
 * somebody else's share, so that has to be asked about; and the desktop picker must
 * never offer the window that is doing the sharing.
 */

/** jsdom has no `MediaStream`, and nothing here reads anything off one. */
const shared = () => ({ id: 'screen-stream' }) as MediaStream

const source = (overrides: Partial<ScreenSource> = {}): ScreenSource => ({
  id: 'window:1',
  name: 'Spreadsheet',
  kind: 'window',
  ...overrides,
})

describe('the share on screen', () => {
  it('names whose screen it is, because a picture cannot say so', () => {
    render(<ShareStage sharerName="Ada" mine={false} stream={shared()} />)

    // The name is on the element a screen reader reaches as well as drawn over the
    // corner of it: a share with no owner is four people asking whose it is.
    expect(screen.getByLabelText('Ada: shared screen')).toBeInTheDocument()
    expect(screen.getByTestId('share-stage')).toHaveTextContent('Ada')
  })

  it('waits, rather than looking broken, before the stream arrives', () => {
    // The call has already said somebody is sharing; the stream is a beat behind it.
    render(<ShareStage sharerName="Ada" mine={false} stream={null} />)

    expect(screen.getByTestId('share-stage')).toHaveTextContent(/waiting for ada/i)
  })

  it('never plays your own screen back to you', () => {
    const { container } = render(<ShareStage sharerName="Ada" mine stream={shared()} />)

    // A capture of this screen drawn on this screen is the hall of mirrors, and it
    // tells the person nothing they do not already know.
    expect(container.querySelector('video')).toBeNull()
    expect(screen.getByTestId('share-stage')).toHaveTextContent(/you are sharing your screen/i)
  })

  it('offers the sharer a way to stop from the stage itself', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    render(<ShareStage sharerName="Ada" mine onStop={onStop} />)

    await user.click(screen.getByRole('button', { name: /stop sharing/i }))
    expect(onStop).toHaveBeenCalled()
  })
})

describe('the reminder that you are sharing', () => {
  it('says so, and stops in one click', async () => {
    // Forgetting to stop is the commonest failure in any call product, and its
    // consequence is somebody's inbox on a projector.
    const user = userEvent.setup()
    const onStop = vi.fn()
    render(<SharingBanner onStop={onStop} />)

    expect(screen.getByTestId('sharing-banner')).toHaveTextContent(/you are sharing your screen/i)
    await user.click(screen.getByRole('button', { name: /stop sharing/i }))
    expect(onStop).toHaveBeenCalled()
  })
})

describe('taking over somebody else’s share', () => {
  it('names them, and says what would happen to their share', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<TakeOverDialog sharerName="Grace" onConfirm={onConfirm} onCancel={() => {}} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(/grace is sharing/i)
    // The consequence, not just the question: somebody pressing this is ending a
    // colleague's share, and nothing else on screen would tell them so.
    expect(dialog).toHaveTextContent(/replace theirs/i)

    await user.click(within(dialog).getByRole('button', { name: 'Take over' }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('leaves the other share alone when the answer is no', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<TakeOverDialog sharerName="Grace" onConfirm={onConfirm} onCancel={onCancel} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('the desktop picker', () => {
  it('never offers the app’s own window', () => {
    // The story's rule, and the reason it matters: sharing the window that is doing
    // the sharing is an infinite mirror that looks like a working share.
    render(
      <ScreenSourcePicker
        sources={[
          source({ id: 'window:self', name: 'Office', self: true }),
          source({ id: 'screen:1', name: 'Screen 1', kind: 'screen' }),
        ]}
        onPick={() => {}}
        onCancel={() => {}}
      />,
    )

    expect(screen.queryByRole('button', { name: /office/i })).not.toBeInTheDocument()
    expect(within(screen.getByTestId('screen-sources')).getAllByRole('button')).toHaveLength(1)
  })

  it('says what each one is as well as what it is called', () => {
    // Two entries both called "1" is exactly the confusion this avoids.
    render(
      <ScreenSourcePicker
        sources={[
          source({ id: 'screen:1', name: '1', kind: 'screen' }),
          source({ id: 'window:1', name: '1', kind: 'window' }),
        ]}
        onPick={() => {}}
        onCancel={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Share screen: 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share window: 1' })).toBeInTheDocument()
  })

  it('passes back the id the host gave, untouched', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(
      <ScreenSourcePicker
        sources={[source({ id: 'window:42', name: 'Spreadsheet' })]}
        onPick={onPick}
        onCancel={() => {}}
      />,
    )

    await user.click(screen.getByRole('button', { name: /spreadsheet/i }))
    expect(onPick).toHaveBeenCalledWith('window:42')
  })

  it('says what to do when there is nothing to share', () => {
    // Empty rather than broken. A dialog with an empty list in it and no sentence is
    // indistinguishable from a dialog that failed to load.
    render(<ScreenSourcePicker sources={[]} onPick={() => {}} onCancel={() => {}} />)

    expect(screen.getByRole('dialog')).toHaveTextContent(/nothing available to share/i)
    expect(screen.queryByTestId('screen-sources')).not.toBeInTheDocument()
  })
})

describe('what a live region says about a share', () => {
  it('names the person both times', () => {
    expect(describeShare('Ada', true)).toBe('Ada is sharing their screen.')
    expect(describeShare('Ada', false)).toBe('Ada stopped sharing their screen.')
  })
})

/**
 * The view following the share, and giving itself back.
 *
 * The half that makes the automatic switch acceptable is the restore: without it,
 * one share leaves everybody in a view they never chose for the rest of the day.
 */
describe('everybody’s view when a share starts', () => {
  /** A little harness holding the view the way the app holds it. */
  function viewing(startingCallView: boolean) {
    const setCallView = vi.fn()
    let callView = startingCallView
    const hook = renderHook(
      ({ sharing }: { sharing: boolean }) =>
        useShareView({
          sharing,
          callView,
          setCallView: (next) => {
            callView = next
            setCallView(next)
          },
        }),
      { initialProps: { sharing: false } },
    )

    return {
      setCallView,
      share: () => hook.rerender({ sharing: true }),
      stop: () => hook.rerender({ sharing: false }),
      /** Somebody pressing the view toggle themselves, mid-share. */
      choose: (next: boolean) => {
        callView = next
        hook.rerender({ sharing: true })
      },
    }
  }

  it('switches to the call, so nobody misses what was put on screen', () => {
    const { setCallView, share } = viewing(false)

    share()

    expect(setCallView).toHaveBeenCalledWith(true)
  })

  it('gives the map back when the share ends', () => {
    const { setCallView, share, stop } = viewing(false)

    share()
    setCallView.mockClear()
    stop()

    expect(setCallView).toHaveBeenCalledWith(false)
  })

  it('leaves somebody who was already in call view exactly where they were', () => {
    const { setCallView, share, stop } = viewing(true)

    share()
    stop()

    // Nothing to restore and nothing to switch: the one person for whom a share
    // should change no layout at all.
    expect(setCallView).not.toHaveBeenCalledWith(false)
  })

  it('does not overrule somebody who went back to the map during the share', () => {
    const { setCallView, share, stop, choose } = viewing(false)

    share()
    choose(false)
    setCallView.mockClear()
    stop()

    // The automatic switch is a default and not a lock, and a choice made a moment
    // ago outranks a layout saved before it.
    expect(setCallView).not.toHaveBeenCalled()
  })
})

/**
 * On a phone the call is always full size, so a share has nothing to switch.
 *
 * Following it there saved "full size" as the layout to go back to, and then wrote
 * it into the remembered preference when the share ended — so the next wide screen
 * the same person opened would open in call view.
 */
describe('a share on a screen where the call view is fixed', () => {
  const sharing = (): OfficeState =>
    fromSnapshot({
      officeId: 'office',
      seq: 1,
      people: ['ada', 'grace'].map((userId) => ({
        userId,
        displayName: userId,
        roomId: 'studio',
        devices: [
          {
            deviceId: `${userId}-laptop`,
            kind: 'web' as const,
            inCall: true,
            muted: false,
            cameraOn: false,
            sharing: userId === 'grace',
            speaking: false,
            lastSpokeAt: null,
            handRaisedAt: null,
          },
        ],
        status: 'in_call' as const,
        arrivedAt: '2026-01-01T09:00:00.000Z',
      })),
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
          sharing: {
            userId: 'grace',
            deviceId: 'grace-laptop',
            startedAt: '2026-01-01T09:05:00.000Z',
          },
        },
      ],
      you: { userId: 'ada', deviceId: 'ada-laptop', manual: null },
    })

  const client = { on: () => () => {} } as unknown as OfisClient
  const media: CallMedia = {
    peers: new Map(),
    local: { camera: null, screen: null },
    quality: new Map(),
    mutedForMe: new Set(),
    problems: [],
    degraded: null,
  }

  it('leaves the view alone when it is fixed', () => {
    const setCallView = vi.fn()
    renderHook(() =>
      useShare(client, sharing(), media, { callView: true, setCallView, fixed: true }),
    )

    expect(setCallView).not.toHaveBeenCalled()
  })

  it('still follows the share where the view is a choice', () => {
    const setCallView = vi.fn()
    renderHook(() => useShare(client, sharing(), media, { callView: false, setCallView }))

    expect(setCallView).toHaveBeenCalledWith(true)
  })
})
