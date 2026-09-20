import type { DeviceKind, OfficeSnapshot, PublicPresence } from '@unityevolv/ofiskit-realtime-core/protocol'
import { describe, expect, it } from 'vitest'

import {
  applyChange,
  applyDiff,
  emptyOffice,
  fromSnapshot,
  isLocked,
  isPhoneOnly,
  occupancy,
  peopleIn,
  yourRoom,
} from './office-state.js'

/**
 * A device with nothing happening on it, which is the ordinary case.
 *
 * A helper because the call fields are required and almost never the point of the
 * test: a fixture spelling out five falses is noise around the one field that
 * matters.
 */
function device(deviceId: string, kind: DeviceKind = 'web'): PublicPresence['devices'][number] {
  return {
    deviceId,
    kind,
    inCall: false,
    muted: true,
    cameraOn: false,
    sharing: false,
    speaking: false,
  }
}

function person(overrides: Partial<PublicPresence> & { userId: string }): PublicPresence {
  return {
    displayName: overrides.userId,
    roomId: 'reception',
    devices: [device(`${overrides.userId}-laptop`)],
    status: 'available',
    arrivedAt: '2026-01-01T09:00:00.000Z',
    ...overrides,
  }
}

function snapshot(overrides: Partial<OfficeSnapshot> = {}): OfficeSnapshot {
  return {
    officeId: 'office',
    seq: 4,
    people: [person({ userId: 'ada' })],
    locks: [],
    calls: [],
    you: { userId: 'ada', deviceId: 'ada-laptop', manual: null },
    ...overrides,
  }
}

describe('the office on the client', () => {
  it('starts empty and not ready, so the map can show its skeleton', () => {
    const state = emptyOffice('office')
    expect(state.ready).toBe(false)
    expect(state.people.size).toBe(0)
  })

  it('takes the sequence number from the snapshot it was built from', () => {
    const state = fromSnapshot(snapshot())
    expect(state.seq).toBe(4)
    expect(state.ready).toBe(true)
    expect(yourRoom(state)).toBe('reception')
  })

  it('applies the next diff and moves the number on', () => {
    const state = fromSnapshot(snapshot())
    const outcome = applyDiff(state, {
      seq: 5,
      changes: [{ kind: 'person.entered', presence: person({ userId: 'grace' }) }],
    })

    expect(outcome.kind).toBe('applied')
    if (outcome.kind !== 'applied') return
    expect(outcome.state.seq).toBe(5)
    expect(outcome.state.people.size).toBe(2)
  })

  it('drops a diff it has already seen', () => {
    // Duplicates arrive on a reconnect. Applying one twice is not harmful for
    // changes that set state, but it would move the sequence backwards.
    const state = fromSnapshot(snapshot())
    expect(applyDiff(state, { seq: 4, changes: [] }).kind).toBe('stale')
    expect(applyDiff(state, { seq: 1, changes: [] }).kind).toBe('stale')
  })

  it('asks for a snapshot when a number is skipped, rather than guessing', () => {
    // The whole reason the sequence exists. Drawing on from here would be drawing
    // something quietly wrong that stays wrong until somebody reloads.
    const state = fromSnapshot(snapshot())
    expect(applyDiff(state, { seq: 7, changes: [] }).kind).toBe('resync')
  })

  it('asks for a snapshot when a diff arrives before there was ever one', () => {
    expect(applyDiff(emptyOffice(), { seq: 1, changes: [] }).kind).toBe('resync')
  })

  it('never mutates the state it was given', () => {
    // A component that memoised on the people map has to be able to see that it
    // changed. Mutating in place is the hardest class of UI bug to find.
    const state = fromSnapshot(snapshot())
    const before = state.people

    const outcome = applyDiff(state, {
      seq: 5,
      changes: [{ kind: 'person.entered', presence: person({ userId: 'grace' }) }],
    })

    expect(state.people).toBe(before)
    expect(state.people.size).toBe(1)
    if (outcome.kind === 'applied') expect(outcome.state.people).not.toBe(before)
  })

  it('moves somebody without touching anything else about them', () => {
    const state = fromSnapshot(
      snapshot({ people: [person({ userId: 'ada', status: 'dnd', displayName: 'Ada L' })] }),
    )

    const next = applyChange(state, {
      kind: 'person.moved',
      userId: 'ada',
      roomId: 'studio',
      arrivedAt: '2026-01-01T10:00:00.000Z',
    })

    expect(next.people.get('ada')).toMatchObject({
      roomId: 'studio',
      status: 'dnd',
      displayName: 'Ada L',
    })
  })

  it('ignores a move for somebody it has never heard of', () => {
    // Rather than inventing half a person with no name and no status.
    const state = fromSnapshot(snapshot())
    const next = applyChange(state, {
      kind: 'person.moved',
      userId: 'nobody',
      roomId: 'studio',
      arrivedAt: '2026-01-01T10:00:00.000Z',
    })

    expect(next.people.has('nobody')).toBe(false)
    expect(next).toBe(state)
  })

  it('removes somebody who left, and shrugs at a second departure', () => {
    const state = fromSnapshot(snapshot())
    const gone = applyChange(state, { kind: 'person.left', userId: 'ada' })
    expect(gone.people.size).toBe(0)
    expect(applyChange(gone, { kind: 'person.left', userId: 'ada' })).toBe(gone)
  })

  it('tracks locks, and unlocking one that is already open changes nothing', () => {
    const state = fromSnapshot(snapshot())
    const locked = applyChange(state, {
      kind: 'room.locked',
      roomId: 'studio',
      lockedBy: 'ada',
    })
    expect(isLocked(locked, 'studio')).toBe(true)

    const open = applyChange(locked, { kind: 'room.unlocked', roomId: 'studio' })
    expect(isLocked(open, 'studio')).toBe(false)
    expect(applyChange(open, { kind: 'room.unlocked', roomId: 'studio' })).toBe(open)
  })

  it('carries the locks that were in the snapshot', () => {
    // A lock is visible from the whole office, so it has to survive entering.
    const state = fromSnapshot(snapshot({ locks: [{ roomId: 'studio', lockedBy: 'grace' }] }))
    expect(isLocked(state, 'studio')).toBe(true)
  })

  it('orders a room by arrival, so avatars hold still', () => {
    const state = fromSnapshot(
      snapshot({
        people: [
          person({ userId: 'later', roomId: 'studio', arrivedAt: '2026-01-01T09:30:00.000Z' }),
          person({ userId: 'first', roomId: 'studio', arrivedAt: '2026-01-01T09:00:00.000Z' }),
          person({ userId: 'elsewhere', roomId: 'reception' }),
        ],
      }),
    )

    expect(peopleIn(state, 'studio').map((one) => one.userId)).toEqual(['first', 'later'])
    expect(occupancy(state, 'studio')).toBe(2)
  })

  it('breaks an arrival tie stably rather than letting two people swap places', () => {
    const at = '2026-01-01T09:00:00.000Z'
    const state = fromSnapshot(
      snapshot({
        people: [
          person({ userId: 'b', roomId: 'studio', arrivedAt: at }),
          person({ userId: 'a', roomId: 'studio', arrivedAt: at }),
        ],
      }),
    )

    expect(peopleIn(state, 'studio').map((one) => one.userId)).toEqual(['a', 'b'])
  })

  it('counts people rather than devices, because presence is per user', () => {
    const state = fromSnapshot(
      snapshot({
        people: [
          person({
            userId: 'ada',
            roomId: 'studio',
            devices: [
              device('laptop'),
              device('phone', 'mobile'),
            ],
          }),
        ],
      }),
    )

    expect(occupancy(state, 'studio')).toBe(1)
  })

  it('badges somebody who is only on a phone, and nobody who is not', () => {
    // The badge is the only way to tell, since presence is per user. With a
    // laptop among their devices it would say nothing useful.
    expect(isPhoneOnly(person({ userId: 'ada', devices: [device('p', 'mobile')] }))).toBe(
      true,
    )
    expect(
      isPhoneOnly(
        person({
          userId: 'ada',
          devices: [
            device('p', 'mobile'),
            device('l'),
          ],
        }),
      ),
    ).toBe(false)
    expect(isPhoneOnly(person({ userId: 'ada', devices: [] }))).toBe(false)
  })

  it('applies every change in one diff in order', () => {
    const state = fromSnapshot(snapshot())
    const outcome = applyDiff(state, {
      seq: 5,
      changes: [
        { kind: 'person.entered', presence: person({ userId: 'grace', roomId: 'studio' }) },
        { kind: 'person.moved', userId: 'grace', roomId: 'library', arrivedAt: 'x' },
        { kind: 'room.locked', roomId: 'library', lockedBy: 'grace' },
      ],
    })

    expect(outcome.kind).toBe('applied')
    if (outcome.kind !== 'applied') return
    expect(outcome.state.people.get('grace')?.roomId).toBe('library')
    expect(isLocked(outcome.state, 'library')).toBe(true)
  })
})
