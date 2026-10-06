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

/** The names the global object goes by, so `globalThis.document` is caught too. */
const GLOBAL_OBJECTS = new Set(['globalThis', 'self'])

const DOM_MODULES = [/^react-dom(\/|$)/, /^@testing-library\/dom$/, /^jsdom$/]

/**
 * Whether a reference reads the global of its name.
 *
 * Two ways it can: nothing declares it at all, or it resolves to a global the
 * configuration supplied — `globals.browser`, or `globals.node`, which now
 * carries `localStorage` too. Checking only the unresolved ones misses the
 * second, which is the usual case: the realtime client is configured with the
 * browser globals, so `document` there resolves to a configured global and is
 * not unresolved at all. Anything declared in the file — a parameter, an
 * import, a `const` — has a definition and is left alone.
 */
function readsGlobal(reference) {
  const variable = reference.resolved
  if (variable === null) return true
  return variable.scope.type === 'global' && variable.defs.length === 0
}

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
    const report = (node, name) => context.report({ node, messageId: 'domGlobal', data: { name } })

    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source === 'string' && DOM_MODULES.some((re) => re.test(source))) {
          context.report({ node, messageId: 'domModule', data: { source } })
        }
      },

      'Program:exit'() {
        for (const scope of context.sourceCode.scopeManager.scopes) {
          for (const reference of scope.references) {
            const { identifier } = reference
            // A type is erased before anything runs on a phone, so `Element` in an
            // annotation is not the DOM at runtime.
            if (reference.isValueReference === false) continue
            if (!readsGlobal(reference)) continue

            if (DOM_GLOBALS.has(identifier.name)) {
              report(identifier, identifier.name)
              continue
            }

            // `globalThis.document` and `self.localStorage` are the same globals
            // by a longer road.
            const member = identifier.parent
            if (
              GLOBAL_OBJECTS.has(identifier.name) &&
              member?.type === 'MemberExpression' &&
              member.object === identifier
            ) {
              const name = member.computed
                ? member.property.type === 'Literal'
                  ? String(member.property.value)
                  : null
                : member.property.name
              if (name !== null && DOM_GLOBALS.has(name)) report(member, name)
            }
          }
        }
      },
    }
  },
}
