/**
 * The office builder: draw a layout on a background image and emit a template.
 *
 * Built once and used three ways — as a standalone page in the free app, where
 * it exports template.json for a host to drop into a config folder, and in the
 * two wrapper apps, where it saves a catalog or org template. Same component,
 * three hosts, and it does not know which one it is in.
 *
 * React DOM throughout, so it lives here and never in a package a phone
 * imports. There is no builder on mobile.
 */
export { OfficeBuilder, type OfficeBuilderProps } from './OfficeBuilder.js'
export { BuilderCanvas, type BuilderCanvasProps } from './canvas/BuilderCanvas.js'
export type { ChangeOptions, OnChange, Selection, Tool } from './canvas/types.js'
export { PromptStep, backgroundFileName, type PromptStepProps } from './prompt/PromptStep.js'
export { darkVersion } from './prompt/darkVersion.js'
export { useHistory, type History } from './history.js'
export {
  applyPreset,
  defaultSlots,
  loadPromptDocument,
  renderPrompt,
  type PromptDocument,
  type PromptPreset,
  type PromptSlot,
  type SlotValues,
} from './prompt/prompt.js'
