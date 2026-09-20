/**
 * A platform-agnostic package may not reach for the DOM.
 *
 * The realtime client is consumed by a React Native app as well as a web one,
 * so a `document` reference in it is a crash on a phone rather than a type
 * error in CI. `navigator` and `RTCPeerConnection` are deliberately allowed:
 * React Native shims both, so they are cross-platform in practice even though
 * they read as browser globals.
 */
const DOM_GLOBALS = new Set([
  'document',
  'window',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'Element',
  'Node',
  'DocumentFragment',
  'getComputedStyle',
  'matchMedia',
  'alert',
])

const DOM_MODULES = [/^react-dom(\/|$)/, /^@testing-library\/dom$/, /^jsdom$/]

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid DOM globals and DOM modules in packages that must run on React Native too.',
    },
    schema: [],
    messages: {
      domGlobal:
        '`{{name}}` is a DOM global and this package must run on React Native too. Take it as a parameter from the host, or move the code to a ui-* package.',
      domModule:
        "'{{source}}' is DOM-only and this package must run on React Native too. Move the code to a ui-* package.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source === 'string' && DOM_MODULES.some((re) => re.test(source))) {
          context.report({ node, messageId: 'domModule', data: { source } })
        }
      },
      Program(node) {
        const scope = context.sourceCode.getScope(node)
        // Only globals resolve to `through` references with no declaration, so
        // a local variable named `document` is correctly left alone.
        for (const ref of scope.through) {
          if (DOM_GLOBALS.has(ref.identifier.name)) {
            context.report({
              node: ref.identifier,
              messageId: 'domGlobal',
              data: { name: ref.identifier.name },
            })
          }
        }
      },
    }
  },
}
