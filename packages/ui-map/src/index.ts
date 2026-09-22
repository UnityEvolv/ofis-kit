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
  REACTION_VISIBLE_MS,
  speakerOrder,
  useCallMedia,
  useReactions,
  useSpeakerOrder,
  type CallMedia,
  type LiveReaction,
  type PeerMedia,
  type PeerQuality,
} from './useCall.js'
export {
  ReactionFloat,
  ReactionPicker,
  describeReaction,
  type ReactionFloatProps,
  type ReactionPickerProps,
} from './Reactions.js'
/**
 * Showing a screen, and the two questions that sometimes come first.
 *
 * The pickers are a seam rather than a feature: on the web the browser asks, and a
 * desktop host supplies its own list of screens and windows because its browser
 * cannot. Nothing here knows Electron exists.
 */
export {
  ScreenSourcePicker,
  ShareStage,
  SharingBanner,
  TakeOverDialog,
  describeShare,
  type ScreenSourcePickerProps,
  type ShareStageProps,
} from './Share.js'
export { useShare, useShareView, type Share, type UseShareOptions } from './useShare.js'
export { createSounds, type Sounds } from './sounds.js'
export { useSounds, type UseSoundsOptions } from './useSounds.js'
export { tileLayout, VIDEO_ASPECT, type TileLayout } from './tileLayout.js'
export { Control, controlClasses, type ControlProps } from './controls.js'
export { DevicePanel, PermissionPrimer, type DevicePanelProps } from './DevicePanel.js'
export { RoomBar, type RoomBarProps } from './RoomBar.js'
export { StatusControl, type StatusControlProps } from './StatusControl.js'
export { PersonAvatar, type PersonAvatarProps } from './PersonAvatar.js'
export {
  OVERFLOW_COLUMNS,
  OVERFLOW_ROWS,
  OverflowAvatar,
  type OverflowAvatarProps,
} from './Overflow.js'
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
