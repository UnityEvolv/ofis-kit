/**
 * @unityevolv/ofiskit-realtime-client
 *
 * The office state on the client: one snapshot, then diffs, and a resync when a
 * sequence number skips. No DOM anywhere, so a React Native app imports this
 * unchanged and only the drawing differs.
 */
export {
  applyChange,
  applyDiff,
  emptyOffice,
  fromSnapshot,
  isLocked,
  isPhoneOnly,
  lockedBy,
  occupancy,
  peopleIn,
  statusIsChosen,
  you,
  yourRoom,
  type DiffOutcome,
  type OfficeState,
} from './office-state.js'

export {
  createOfisClient,
  type ClientEvent,
  type ConnectionStatus,
  type OfisClient,
  type OfisClientOptions,
} from './client.js'

/**
 * The wire types, re-exported from the one place they are defined.
 *
 * A UI needs `PublicPresence` to draw a person and `Status` to draw a dot, and
 * making it depend on the engine package for them would mean the map imported
 * the server. There is one definition; this is the door to it.
 */
export type {
  CustomStatus,
  DeviceKind,
  ManualStatus,
  OfficeChange,
  OfficeDiff,
  OfficeSnapshot,
  PublicPresence,
  Status,
} from '@unityevolv/ofiskit-realtime-core/protocol'
