/**
 * Where who-is-where lives: the interface, and the in-memory implementation.
 *
 * Apache-2.0, like the other interface packages, so that writing a presence
 * store for some other backing store is not a licensing decision. The engine
 * talks only to the interface; the free office uses the memory store and
 * unityofis uses a Redis one, with no other difference between them.
 */
export type {
  AutomaticStatus,
  CustomStatus,
  DeviceKind,
  DevicePresence,
  Instant,
  Knock,
  ManualStatus,
  Presence,
  RoomLock,
  Status,
} from './types.js'

export type { PresenceStore } from './store.js'
export { DISCONNECT_GRACE_MS, PRESENCE_TTL_MS } from './store.js'

export { MemoryPresenceStore } from './memory.js'

export type { CustomStatusDuration } from './status.js'
export {
  CUSTOM_STATUS_DURATIONS,
  IDLE_AFTER_MS,
  isCustomStatusLive,
  liveCustomStatus,
  resolveStatus,
  suppressesInterruption,
} from './status.js'
