import type { PublicPresence, RoomCall } from '@unityevolv/ofiskit-realtime-client'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CallTiles, TILES_VISIBLE } from './CallTiles.js'
import { speakerOrder } from './useCall.js'
import type { CallMedia } from './useCall.js'

/**
 * The tiles, and the two halves of the five-tile rule.
 *
 * Five bounds what each person downloads; the ordering makes sure the five are the
 * ones worth seeing. A test that only checked the count would pass with the five
 * quietest people on screen.
 */

function device(deviceId: string, overrides: Partial<PublicPresence['devices'][number]> = {}) {
  return {
    deviceId,
    kind: 'web' as const,
    inCall: true,
    muted: false,
    cameraOn: false,
    sharing: false,
    speaking: false,
    lastSpokeAt: null,
    ...overrides,
  }
}

function person(userId: string, devices = [device(`${userId}-laptop`)]): PublicPresence {
  return {
    userId,
    displayName: userId,
    roomId: 'studio',
    devices,
    status: 'in_call',
    arrivedAt: '2026-01-01T09:00:00.000Z',
  }
}

const media = (overrides: Partial<CallMedia> = {}): CallMedia => ({
  peers: new Map(),
  local: { camera: null, screen: null },
  quality: new Map(),
  mutedForMe: new Set(),
  problems: [],
  degraded: null,
  ...overrides,
})

/** A call of `count` people plus you, in arrival order. */
function callOf(names: string[]): { call: RoomCall; people: Map<string, PublicPresence> } {
  const everyone = ['you', ...names]
  return {
    call: {
      roomId: 'studio',
      provider: 'builtin',
      startedAt: '2026-01-01T09:00:00.000Z',
      participants: everyone.map((name) => ({ userId: name, deviceId: `${name}-laptop` })),
      limit: 4,
    },
    people: new Map(everyone.map((name) => [name, person(name)])),
  }
}

function tiles(
  options: {
    names?: string[]
    order?: string[]
    media?: CallMedia
    placement?: 'top' | 'right' | 'grid'
    people?: Map<string, PublicPresence>
  } = {},
) {
  const names = options.names ?? ['grace']
  const built = callOf(names)
  const onMuteForMe = vi.fn()
  const onVisibleChange = vi.fn()

  const view = render(
    <CallTiles
      call={built.call}
      people={options.people ?? built.people}
      order={options.order ?? built.call.participants.map((one) => one.deviceId)}
      media={options.media ?? media()}
      you={{ userId: 'you', deviceId: 'you-laptop' }}
      placement={options.placement ?? 'top'}
      onMuteForMe={onMuteForMe}
      onVisibleChange={onVisibleChange}
    />,
  )

  return { ...built, onMuteForMe, onVisibleChange, view, user: userEvent.setup() }
}

describe('the tiles', () => {
  it('says how many people are in the call', () => {
    tiles({ names: ['grace', 'alan'] })
    expect(screen.getByRole('region', { name: /call with 3 people/i })).toBeInTheDocument()
  })

  it('pins your own tile and does not count it in the five', () => {
    // Seeing yourself should never cost somebody else their place.
    tiles({ names: ['a', 'b', 'c', 'd', 'e'] })

    expect(screen.getByTestId('tile-you-laptop')).toBeInTheDocument()
    // Five others, plus you.
    expect(screen.getAllByTestId(/^tile-/)).toHaveLength(TILES_VISIBLE + 1)
  })

  it('shows at most five others, whatever the size of the call', () => {
    tiles({ names: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })

    const drawn = screen.getAllByTestId(/^tile-/).map((one) => one.dataset.testid)
    expect(drawn).toHaveLength(TILES_VISIBLE + 1)
    expect(drawn).toContain('tile-you-laptop')
  })

  it('says how many are off screen, which is the useful part', () => {
    tiles({ names: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })
    // Seven others, five shown: two you are not seeing.
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('offers no paging when everybody fits', () => {
    tiles({ names: ['grace'] })
    expect(screen.queryByRole('button', { name: /more tiles/i })).not.toBeInTheDocument()
  })

  it('pages, and the page decides which peers send video', async () => {
    // Without this the five-tile rule would bound what is drawn and not what is
    // downloaded, which is the half that actually costs anything.
    const { user, onVisibleChange } = tiles({ names: ['a', 'b', 'c', 'd', 'e', 'f'] })

    expect(onVisibleChange).toHaveBeenLastCalledWith([
      'a-laptop',
      'b-laptop',
      'c-laptop',
      'd-laptop',
      'e-laptop',
    ])

    await user.click(screen.getByRole('button', { name: /more tiles/i }))

    expect(onVisibleChange).toHaveBeenLastCalledWith(['f-laptop'])
    expect(screen.getByTestId('tile-f-laptop')).toBeInTheDocument()
    expect(screen.queryByTestId('tile-a-laptop')).not.toBeInTheDocument()
  })

  it('keeps the person talking among the five', () => {
    // Six others in the call, and the sixth by arrival is the one speaking.
    const names = ['a', 'b', 'c', 'd', 'e', 'late']
    const built = callOf(names)
    built.people.set(
      'late',
      person('late', [device('late-laptop', { lastSpokeAt: '2026-01-01T10:00:00.000Z' })]),
    )

    tiles({
      names,
      people: built.people,
      order: speakerOrder(built.call.participants, built.people),
    })

    expect(screen.getByTestId('tile-late-laptop')).toBeInTheDocument()
  })

  it('draws a name when the camera is off, not a broken tile', () => {
    tiles({ names: ['grace'] })
    const tile = screen.getByTestId('tile-grace-laptop')
    // Twice: once as the placeholder where the picture would be, once on the name
    // strip. Both are wanted — the point is that neither is a broken video element.
    expect(within(tile).getAllByText('grace')).toHaveLength(2)
    expect(tile.querySelector('video')).toBeNull()
  })

  it('draws video when there is a stream, muted, because the sound is elsewhere', () => {
    // An unmuted tile would play everybody twice: the audio sink is the one path.
    const stream = { id: 's' } as MediaStream
    tiles({
      names: ['grace'],
      media: media({ peers: new Map([['grace-laptop', { camera: stream }]]) }),
    })

    const video = screen.getByTestId('tile-grace-laptop').querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.muted).toBe(true)
  })

  it('renders no audio element at all, so nobody is heard twice', () => {
    const { view } = tiles({
      names: ['grace'],
      media: media({ peers: new Map([['grace-laptop', { audio: { id: 'a' } as MediaStream }]]) }),
    })
    expect(view.container.querySelectorAll('audio')).toHaveLength(0)
  })

  it('rings the tile of whoever is talking, and says so as well as drawing it', () => {
    // The same ring as on the map, because "who is talking" should look like one
    // thing wherever it appears — and said out loud, because a ring is invisible
    // to a screen reader.
    const built = callOf(['grace'])
    built.people.set('grace', person('grace', [device('grace-laptop', { speaking: true })]))

    tiles({ names: ['grace'], people: built.people })

    const tile = screen.getByTestId('tile-grace-laptop')
    expect(tile.className).toMatch(/ring-primary/)
    expect(tile).toHaveTextContent(/grace, speaking/i)
  })

  it('shows a muted microphone and a weak connection on the tile', () => {
    const built = callOf(['grace'])
    built.people.set('grace', person('grace', [device('grace-laptop', { muted: true })]))

    tiles({
      names: ['grace'],
      people: built.people,
      media: media({
        quality: new Map([['grace-laptop', { relayed: true, packetLoss: 0.2, roundTripMs: 500 }]]),
      }),
    })

    const tile = screen.getByTestId('tile-grace-laptop')
    // The kit's Icon turns a title into an accessible name, which is what a screen
    // reader reads — so that is what this looks for.
    expect(within(tile).getByRole('img', { name: /microphone off/i })).toBeInTheDocument()
    expect(
      within(tile).getByRole('img', { name: /relayed, weak connection/i }),
    ).toBeInTheDocument()
  })

  it('mutes somebody for yourself only, and says so in one place a click can undo', async () => {
    // No permission needed and nobody is told: this is the answer to background
    // noise in a call with no host.
    const { user, onMuteForMe } = tiles({ names: ['grace'] })

    await user.click(
      screen.getByRole('button', { name: /mute grace for yourself only/i }),
    )
    expect(onMuteForMe).toHaveBeenCalledWith('grace-laptop', true)
  })

  it('shows a muted-for-me tile as such, and offers to undo it', () => {
    tiles({ names: ['grace'], media: media({ mutedForMe: new Set(['grace-laptop']) }) })

    expect(screen.getByText(/muted for you/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /unmute grace for yourself/i }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('never offers to mute yourself for yourself', () => {
    tiles({ names: ['grace'] })
    const own = screen.getByTestId('tile-you-laptop')
    expect(within(own).queryByRole('button')).not.toBeInTheDocument()
  })

  it('is a strip on a landscape office and a column on a tall one', () => {
    const { view } = tiles({ placement: 'top' })
    expect(screen.getByTestId('call-tiles')).toHaveAttribute('data-placement', 'top')
    expect(screen.getByTestId('call-tiles').className).toMatch(/flex-row/)
    view.unmount()

    tiles({ placement: 'right' })
    expect(screen.getByTestId('call-tiles').className).toMatch(/flex-col/)
  })
})

describe('the speaking order', () => {
  const people = new Map<string, PublicPresence>([
    ['quiet', person('quiet', [device('quiet-laptop')])],
    ['early', person('early', [device('early-laptop', { lastSpokeAt: '2026-01-01T09:00:00.000Z' })])],
    ['recent', person('recent', [device('recent-laptop', { lastSpokeAt: '2026-01-01T09:05:00.000Z' })])],
  ])

  const participants = [
    { userId: 'quiet', deviceId: 'quiet-laptop' },
    { userId: 'early', deviceId: 'early-laptop' },
    { userId: 'recent', deviceId: 'recent-laptop' },
  ]

  it('puts the most recent speaker first and the silent last', () => {
    expect(speakerOrder(participants, people)).toEqual([
      'recent-laptop',
      'early-laptop',
      'quiet-laptop',
    ])
  })

  it('breaks a tie stably, so people who never spoke keep their places', () => {
    // Otherwise the tiles shuffle on every render for no reason anybody can see.
    const silent = new Map<string, PublicPresence>([
      ['b', person('b', [device('b-laptop')])],
      ['a', person('a', [device('a-laptop')])],
    ])
    const order = [
      { userId: 'b', deviceId: 'b-laptop' },
      { userId: 'a', deviceId: 'a-laptop' },
    ]

    expect(speakerOrder(order, silent)).toEqual(['a-laptop', 'b-laptop'])
    expect(speakerOrder([...order].reverse(), silent)).toEqual(['a-laptop', 'b-laptop'])
  })

  it('is the same answer for everybody, because the server stamps the time', () => {
    // A client that joined a minute ago has no less idea of who spoke recently
    // than one that has been listening throughout.
    const fromScratch = speakerOrder(participants, people)
    const again = speakerOrder([...participants].reverse(), people)
    expect(again).toEqual(fromScratch)
  })
})
