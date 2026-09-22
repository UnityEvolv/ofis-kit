/**
 * Everything in this package that runs anywhere: Node, a browser, a phone.
 *
 * The same as the main entry point less the one template source that reads a
 * file, which is the only thing here that needs a file system. A host in a
 * browser (the demo, which runs the whole office in a tab) or in React Native
 * imports this, and never pulls `node:fs` into a bundle that cannot use it.
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

export type { TemplateSource } from './template-source.js'
export { TemplateInvalid, joinImagePath, staticTemplateSource } from './template-source.js'

export type {
  AccessRevoked,
  EventBus,
  ExternalStatusChanged,
  HostEvent,
  HostEventHandler,
  TemplateChanged,
} from './events.js'
export { localEventBus, silentEventBus } from './events.js'

export type { RateLimiter, RateLimitVerdict } from './rate-limit.js'
export { memoryRateLimiter, unlimited } from './rate-limit.js'

/** Re-exported so nothing has to import the template package to report an error. */
export type { ErrorEnvelope } from '@unityevolv/ofiskit-template'
