/**
 * No personal data in logs, ever.
 *
 * IDs are fine and are what you actually want when reading a log; names, emails
 * and photo URLs are not, and a log line is the easiest place in a system for
 * personal data to end up somewhere it was never meant to go. Logs are shipped,
 * retained and searched by people who were never granted access to the office.
 *
 * The rule is a heuristic on purpose: it flags an identifier or property whose
 * name says it holds personal data, and it flags logging a whole identity object
 * (whose shape it cannot see). It cannot catch everything, and the review
 * checklist still asks. Catching the ordinary mistake is worth the false
 * positive that a disable comment resolves.
 */
const PII_NAMES = new Set([
  'email',
  'emailaddress',
  'name',
  'displayname',
  'fullname',
  'firstname',
  'lastname',
  'givenname',
  'familyname',
  'phone',
  'phonenumber',
  'photo',
  'photourl',
  'avatarurl',
  'address',
  'ip',
  'ipaddress',
])

/** Objects whose whole shape is personal data, so logging them at all is wrong. */
const PII_OBJECTS = new Set(['user', 'identity', 'person', 'participant', 'member', 'profile'])

const LOG_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug', 'trace', 'fatal', 'child'])

function normalise(name) {
  return String(name).toLowerCase().replace(/[_-]/g, '')
}

function context_text(node) {
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    return `${context_text(node.object)}.${node.property.name}`
  }
  if (node.type === 'ThisExpression') return 'this'
  return ''
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid personal data in log calls; log IDs instead.' },
    schema: [],
    messages: {
      piiField:
        '`{{name}}` is personal data and must not be logged. Log the id instead — that is what you want when reading the log anyway.',
      piiObject:
        '`{{name}}` holds personal data (a display name, an email or a photo). Log `{{name}}.id` instead of the whole object.',
    },
  },
  create(context) {
    /** Walks an argument for the two shapes worth flagging. */
    function inspect(node) {
      if (!node) return
      switch (node.type) {
        case 'Identifier':
          if (PII_NAMES.has(normalise(node.name))) {
            context.report({ node, messageId: 'piiField', data: { name: node.name } })
          } else if (PII_OBJECTS.has(normalise(node.name))) {
            context.report({ node, messageId: 'piiObject', data: { name: node.name } })
          }
          return
        case 'MemberExpression': {
          if (!node.computed && node.property.type === 'Identifier') {
            const property = normalise(node.property.name)
            // `user.id` is the encouraged form, so a PII object is only a
            // problem when the property read off it is itself personal.
            if (PII_NAMES.has(property)) {
              context.report({
                node,
                messageId: 'piiField',
                data: { name: context_text(node) || node.property.name },
              })
              return
            }
          }
          return
        }
        case 'TemplateLiteral':
          node.expressions.forEach(inspect)
          return
        case 'BinaryExpression':
          if (node.operator === '+') {
            inspect(node.left)
            inspect(node.right)
          }
          return
        case 'ObjectExpression':
          for (const property of node.properties) {
            if (property.type === 'SpreadElement') {
              inspect(property.argument)
              continue
            }
            const key = property.key
            if (!property.computed && key && (key.type === 'Identifier' || key.type === 'Literal')) {
              const name = key.type === 'Identifier' ? key.name : key.value
              if (PII_NAMES.has(normalise(name))) {
                context.report({ node: property, messageId: 'piiField', data: { name } })
                continue
              }
              // `{ user }` shorthand puts the whole identity in the line.
              if (PII_OBJECTS.has(normalise(name)) && property.value.type !== 'MemberExpression') {
                context.report({ node: property, messageId: 'piiObject', data: { name } })
                continue
              }
            }
            inspect(property.value)
          }
          return
        default:
          return
      }
    }

    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression' || callee.computed) return
        if (callee.property.type !== 'Identifier') return
        if (!LOG_METHODS.has(callee.property.name)) return
        if (!/(?:^|\.)(?:console|logger|log)$/i.test(context_text(callee.object))) return
        node.arguments.forEach(inspect)
      },
    }
  },
}
