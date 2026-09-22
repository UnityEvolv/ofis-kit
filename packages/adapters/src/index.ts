/**
 * The interfaces the office asks its host, and the answers the free office gives.
 *
 * Apache-2.0, deliberately, so that writing an adapter is not a licensing
 * decision. Everything the engine cannot work out for itself arrives through one
 * of these, and the free office's implementations are short enough to read in
 * one sitting — which is the clearest possible statement of where the boundary is.
 */
export * from './portable.js'

export type { FileTemplateSourceOptions } from './template-file.js'
export { fileTemplateSource } from './template-file.js'
