/**
 * No product hostname, origin or absolute product URL as a literal.
 *
 * The product has to be able to move from unityofis.unityevolv.com to its own
 * domain by changing one variable, and the demo has to be able to run on a
 * stranger's box. Every hostname therefore comes from configuration, and every
 * link the product emits is built by one helper from that configuration.
 *
 * Only product hostnames are flagged. A W3C namespace URL or a licence URL is
 * not something anyone will ever need to reconfigure.
 */
// A subdomain needs no pattern of its own: the dot before the product's name
// is one of the boundaries. A repeated `(?:[a-z0-9-]+\.)*` there made the
// expression backtrack polynomially on input like `-.-.-.-`.
const PRODUCT_HOST = /(?:^|[/@.\s"'`])(?:unityevolv|unityofis|ofiskit)\.(?:com|dev|io|net|app)\b/i
const ORIGIN_WITH_PORT = /^(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i

function check(context, node, value) {
  if (typeof value !== 'string') return
  if (PRODUCT_HOST.test(value)) {
    context.report({ node, messageId: 'productHost', data: { value } })
    return
  }
  if (ORIGIN_WITH_PORT.test(value)) {
    context.report({ node, messageId: 'localOrigin', data: { value } })
  }
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid product hostnames and origins as string literals in code.' },
    schema: [],
    messages: {
      productHost:
        "'{{value}}' is a product hostname. Read it from configuration and build the URL with the url helper, so the product can change domain by changing one variable.",
      localOrigin:
        "'{{value}}' is a hard-coded origin. Read the base URL from configuration; a default belongs in the config module, not here.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        check(context, node, node.value)
      },
      TemplateElement(node) {
        check(context, node, node.value.cooked)
      },
    }
  },
}
