/**
 * The repo's boundary rules, as lint.
 *
 * Every rule here exists because a story asked for a check rather than a
 * convention: a convention is remembered by whoever read it, a check is
 * remembered by CI. Each one has a test that proves it actually fails, because
 * a lint rule nobody has seen fail is indistinguishable from one that does not
 * run at all.
 *
 * These three are the layout's own rules. Others arrive with the stories that
 * ask for them.
 */
import noDomInAgnostic from './rules/no-dom-in-agnostic.js'
import noHostnameLiteral from './rules/no-hostname-literal.js'
import noProviderSdkOutsideAdapter from './rules/no-provider-sdk-outside-adapter.js'
import noPiiInLogs from './rules/no-pii-in-logs.js'

export default {
  meta: { name: 'eslint-plugin-ofiskit', version: '0.0.0' },
  rules: {
    'no-dom-in-agnostic': noDomInAgnostic,
    'no-hostname-literal': noHostnameLiteral,
    'no-provider-sdk-outside-adapter': noProviderSdkOutsideAdapter,
    'no-pii-in-logs': noPiiInLogs,
  },
}
