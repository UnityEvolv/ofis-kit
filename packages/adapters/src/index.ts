/**
 * The interfaces the office asks its host, and the answers the free office gives.
 *
 * Apache-2.0, deliberately, so that writing an adapter is not a licensing
 * decision. Everything the engine cannot work out for itself arrives through one
 * of these, and the free office's implementations are short enough to read in
 * one sitting — which is the clearest possible statement of where the boundary is.
 */
export type {
  AuthenticationRefused,
  ConnectionContext,
  Decision,
  Identity,
  IdentityAdapter,
  Permission,
  PermissionQuestion,
  TypedEmailCredentials,
} from './identity.js'
export { allow, idForEmail, refuse, typedEmailIdentity } from './identity.js'

export type { FileTemplateSourceOptions, TemplateSource } from './template-source.js'
export { TemplateInvalid, fileTemplateSource, staticTemplateSource } from './template-source.js'

export type {
  AccessRevoked,
  EventBus,
  ExternalStatusChanged,
  HostEvent,
  HostEventHandler,
  TemplateChanged,
} from './events.js'
export { localEventBus, silentEventBus } from './events.js'

/** Re-exported so nothing has to import the template package to report an error. */
export type { ErrorEnvelope } from '@unityevolv/ofiskit-template'
