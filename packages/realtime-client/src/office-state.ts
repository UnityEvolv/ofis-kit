import type {
  OfficeChange,
  OfficeDiff,
  ManualStatus,
  OfficeSnapshot,
  PublicPresence,
} from '@unityevolv/ofiskit-realtime-core/protocol'

/**
 * The office as the client believes it to be.
 *
 * One snapshot on entry, then diffs. The whole design rests on the sequence
 * number: a client that applies a diff numbered two higher than the last one has
 * missed something, and drawing the office from then on would be drawing
 * something quietly wrong that stays wrong until somebody reloads.
 *
 * So the rule is: notice the gap, ask for a snapshot, carry on. That is what
 * `applyDiff` returning `resync` means, and it is the only correct response.
 *
 * A pure reducer with no socket and no framework in it, because the web map and
 * a React Native list consume this same state and the only thing that differs
 * between them is the drawing.
 */

export interface OfficeState {
  officeId: string
  seq: number
  /** Keyed by user, because presence is per user and so are moves. */
  people: Map<string, PublicPresence>
  /** roomId → who locked it. */
  locks: Map<string, string>
  you: { userId: string; deviceId: string; manual: ManualStatus | null }
  /** False until the first snapshot lands, so the map can show its skeleton. */
  ready: boolean
}

export function emptyOffice(officeId = ''): OfficeState {
  return {
    officeId,
    seq: 0,
    people: new Map(),
    locks: new Map(),
    you: { userId: '', deviceId: '', manual: null },
    ready: false,
  }
}

export function fromSnapshot(snapshot: OfficeSnapshot): OfficeState {
  return {
    officeId: snapshot.officeId,
    seq: snapshot.seq,
    people: new Map(snapshot.people.map((person) => [person.userId, person])),
    locks: new Map(snapshot.locks.map((lock) => [lock.roomId, lock.lockedBy])),
    you: snapshot.you,
    ready: true,
  }
}

/** What applying a diff concluded. */
export type DiffOutcome =
  | { kind: 'applied'; state: OfficeState }
  /** Already seen. Duplicates arrive on a reconnect and are simply dropped. */
  | { kind: 'stale' }
  /** A gap. Ask the server for a fresh snapshot; do not guess. */
  | { kind: 'resync' }

export function applyDiff(state: OfficeState, diff: OfficeDiff): DiffOutcome {
  // A diff before any snapshot is not a gap so much as nothing to apply it to.
  if (!state.ready) return { kind: 'resync' }
  if (diff.seq <= state.seq) return { kind: 'stale' }
  if (diff.seq !== state.seq + 1) return { kind: 'resync' }

  let next = state
  for (const change of diff.changes) next = applyChange(next, change)
  return { kind: 'applied', state: { ...next, seq: diff.seq } }
}

/**
 * Apply one change.
 *
 * Every branch copies the map it touches rather than mutating in place, so a
 * React render that captured the previous state keeps seeing the previous
 * office. Mutating would make a component that memoised on the map miss the
 * update entirely, which is the hardest class of bug to see in a UI.
 */
export function applyChange(state: OfficeState, change: OfficeChange): OfficeState {
  switch (change.kind) {
    case 'person.entered':
    case 'person.updated': {
      const people = new Map(state.people)
      people.set(change.presence.userId, change.presence)
      return { ...state, people }
    }

    case 'person.moved': {
      const existing = state.people.get(change.userId)
      // A move for somebody we have never heard of means our state is behind.
      // The sequence check above is what normally catches that, and ignoring it
      // here is the safe response rather than inventing half a person.
      if (!existing) return state
      const people = new Map(state.people)
      people.set(change.userId, {
        ...existing,
        roomId: change.roomId,
        arrivedAt: change.arrivedAt,
      })
      return { ...state, people }
    }

    case 'person.left': {
      if (!state.people.has(change.userId)) return state
      const people = new Map(state.people)
      people.delete(change.userId)
      return { ...state, people }
    }

    case 'room.locked': {
      const locks = new Map(state.locks)
      locks.set(change.roomId, change.lockedBy)
      return { ...state, locks }
    }

    case 'room.unlocked': {
      if (!state.locks.has(change.roomId)) return state
      const locks = new Map(state.locks)
      locks.delete(change.roomId)
      return { ...state, locks }
    }
  }
}

// ---------------------------------------------------------------- reading it

/**
 * Everyone in a room, in arrival order.
 *
 * Arrival order is what stops avatars shuffling around their cells as other
 * people come and go. Somebody who has been sitting in the corner of a room for
 * an hour should still be in that corner. The user id breaks ties, so two people
 * who arrived in the same millisecond still have one stable order rather than
 * swapping places on every render.
 */
export function peopleIn(state: OfficeState, roomId: string): PublicPresence[] {
  return [...state.people.values()]
    .filter((person) => person.roomId === roomId)
    .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt) || a.userId.localeCompare(b.userId))
}

export function isLocked(state: OfficeState, roomId: string): boolean {
  return state.locks.has(roomId)
}

export function lockedBy(state: OfficeState, roomId: string): string | null {
  return state.locks.get(roomId) ?? null
}

/** How many people are in a room. Counts people, because presence is per user. */
export function occupancy(state: OfficeState, roomId: string): number {
  return peopleIn(state, roomId).length
}

export function you(state: OfficeState): PublicPresence | null {
  return state.people.get(state.you.userId) ?? null
}

/** The room the viewer is standing in, if the office has told us yet. */
export function yourRoom(state: OfficeState): string | null {
  return you(state)?.roomId ?? null
}

/**
 * Whether the status you are showing is one you chose.
 *
 * The difference the control turns on: a chosen status offers a way back to
 * automatic, and a worked-out one has nothing to go back from.
 */
export function statusIsChosen(state: OfficeState): boolean {
  return state.you.manual !== null
}

/**
 * Whether this person is here only from a phone.
 *
 * Drives the device badge. Presence is per user, so this is the only way to tell
 * that somebody is on a phone and may not be able to do much. No badge when a
 * desktop or web session is among their devices, because then it says nothing
 * useful.
 */
export function isPhoneOnly(person: PublicPresence): boolean {
  return person.devices.length > 0 && person.devices.every((device) => device.kind === 'mobile')
}
