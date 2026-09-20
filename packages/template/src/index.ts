/**
 * The office layout, as data: the schema, the geometry, and the validator.
 *
 * Apache-2.0 rather than AGPL, like the other interface packages, so that
 * reading or writing an ofiskit template is not a licensing decision. The
 * template.json a free office reads and the layout unityofis stores are this
 * same object, which is what lets a template built in the free builder import
 * into the product unchanged.
 */
export type {
  AvatarSize,
  BarPosition,
  CanvasShape,
  Rect,
  Room,
  RoomType,
  Template,
  TemplateImages,
  UserArea,
} from './types.js'
export {
  AVATAR_SIZES,
  BAR_POSITIONS,
  CANVAS_SHAPES,
  MAX_ROOMS,
  REQUIRED_ROOM_TYPES,
  ROOMS_WITHOUT_CALLS,
  ROOM_TYPES,
  hostsCalls,
  isRequired,
} from './types.js'

export type { ErrorEnvelope, TemplateErrorCode, TemplateIssue, Validated } from './errors.js'
export { TemplateError, issue } from './errors.js'

export {
  AVATAR_UNIT_PX,
  BAR_PX,
  CANVAS_RATIO,
  CANVAS_RECT,
  EPSILON,
  REFERENCE_VIEWPORT,
  areaRect,
  avatarUnit,
  barHeight,
  barRect,
  canvasPixels,
  minRoomSize,
  rectContains,
  rectsOverlap,
  snapToUnits,
  unitsAcross,
  usableRect,
} from './geometry.js'

export { parseTemplate, validateRoom, validateTemplate } from './validate.js'

export type { CreateTemplateOptions, UnfittedArea } from './create.js'
export { addRoom, centredArea, createTemplate, withAvatarSize } from './create.js'

export { idMintedAt, isId, newId } from './id.js'
