/**
 * The office you can see.
 *
 * React DOM, built on unitykit, and deliberately not platform-agnostic: this is
 * the package that holds the web-only half, so everything below it can run on a
 * phone. In this app the map fills the window; in unityofis the same components
 * render inside the app shell, which adds the header and the switchers and
 * changes nothing here.
 *
 * Nothing here chooses a colour. Every surface is a kit component with a
 * theme-aware background, because the office background is whatever an author
 * generated and nothing legible can be guaranteed on top of it.
 */
export { ThemeProvider, useTheme, type Theme, type ThemeChoice } from './theme.js'

export { AnnouncerProvider, useAnnounce } from './Announcer.js'

export {
  KnockDock,
  OutgoingKnock,
  type IncomingKnock,
  type KnockDockProps,
  type KnockOutcome,
  type OutgoingKnockProps,
} from './Knocks.js'

export {
  MaximiseButton,
  OfficeMap,
  RoomListView,
  ViewToggle,
  useMaximised,
  type OfficeMapProps,
  type OfficeView,
} from './OfficeMap.js'

export { CallAudio, type CallAudioProps } from './CallAudio.js'
export { CallControls, type CallControlsProps } from './CallControls.js'
export { CallTiles, TILES_VISIBLE, type CallTilesProps } from './CallTiles.js'
export {
  speakerOrder,
  useCallMedia,
  useSpeakerOrder,
  type CallMedia,
  type PeerMedia,
  type PeerQuality,
} from './useCall.js'
export { DevicePanel, PermissionPrimer, type DevicePanelProps } from './DevicePanel.js'
export { RoomBar, type RoomBarProps } from './RoomBar.js'
export { StatusControl, type StatusControlProps } from './StatusControl.js'
export { PersonAvatar, type PersonAvatarProps } from './PersonAvatar.js'
export { StatusDot, describeStatus, statusLabel, STATUS_LOOKS, type StatusDotProps } from './status.js'

export {
  useClientEvents,
  useIdleReporting,
  useMeasured,
  useMediaQuery,
  useOffice,
  usePersisted,
  useReducedMotion,
} from './hooks.js'

export {
  fitCanvas,
  readingOrder,
  roomInDirection,
  tilePlacement,
  toPixels,
  type CanvasBox,
} from './layout.js'

export {
  placeInRoom,
  tokensFor,
  type DevicesToDraw,
  type PlacedAvatar,
  type Placement,
  type Token,
} from './placement.js'
