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
  callDevices,
  callIn,
  callSeats,
  emptyOffice,
  fromSnapshot,
  handRaised,
  isLocked,
  isMuted,
  isPhoneOnly,
  isSharing,
  isSpeaking,
  lockedBy,
  occupancy,
  peopleIn,
  raisedHands,
  statusIsChosen,
  you,
  yourRoom,
  type DiffOutcome,
  type OfficeState,
} from './office-state.js'

/**
 * The provider interface, client half.
 *
 * Exported as types and constants only: the built-in implementation arrives with
 * the signalling story, and an external provider's adapter is written against
 * exactly this and nothing more.
 */
export {
  AUDIO_BITRATE,
  CONNECT_TIMEOUT_MS,
  SCREEN_CEILING,
  VIDEO_STEPS,
  type JoinOptions,
  type RtcClientAdapter,
  type RtcEvent,
  type RtcHandler,
  type Signaller,
} from './rtc/adapter.js'

export { meshAdapter, describeMediaError } from './rtc/mesh.js'

/**
 * Choosing a microphone, a camera and a speaker, and coping when the browser says
 * no.
 *
 * Almost all of the value is in the failure cases: picking from a list is easy,
 * and telling somebody the difference between "you denied permission" and
 * "something else is holding your camera" is what stops a support ticket.
 */
export {
  labelFor,
  listDevices,
  memoryDeviceStorage,
  requestPermission,
  stillAvailable,
  watchDevices,
  type DeviceChoice,
  type DeviceStorage,
  type Devices,
  type PermissionOutcome,
} from './rtc/devices.js'

export {
  createOfisClient,
  type ClientEvent,
  type ConnectionStatus,
  type OfisClient,
  type OfisClientOptions,
} from './client.js'

/**
 * The reactions, from the one place they are defined.
 *
 * The only runtime value this package takes from the core, and it is a frozen
 * array of six strings — not the engine, which lives behind the package's other
 * entry point and is never reachable from here. It has to be the same list on
 * both sides: the server refuses anything not in it, and the picker draws
 * exactly it. Two copies would drift, and the drift is a reaction one person
 * sends and nobody else can see.
 */
export { REACTIONS, type Reaction } from '@unityevolv/ofiskit-realtime-core/protocol'

/**
 * The wire types, re-exported from the one place they are defined.
 *
 * A UI needs `PublicPresence` to draw a person and `Status` to draw a dot, and
 * making it depend on the engine package for them would mean the map imported
 * the server. There is one definition; this is the door to it.
 */
export type {
  CallJoinRequest,
  CallJoinResponse,
  CustomStatus,
  DeviceKind,
  ManualStatus,
  OfficeChange,
  OfficeDiff,
  IceServer,
  OfficeSnapshot,
  PublicPresence,
  RoomCall,
  Status,
} from '@unityevolv/ofiskit-realtime-core/protocol'
