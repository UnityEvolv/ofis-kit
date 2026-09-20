/**
 * Icons come from unitykit's Icon component, never from lucide-react directly.
 *
 * The kit's Icon fixes the sizes, the stroke and the accessible naming, so an
 * icon imported around it is a different size and a different weight from every
 * other icon on the page. The kit already depends on lucide, so importing it
 * again also costs a second copy in the bundle.
 */
export default {
  meta: {
    type: 'problem',
    docs: { description: "Forbid importing lucide-react directly; use unitykit's Icon." },
    schema: [],
    messages: {
      direct:
        "Import { Icon } from '@unityevolv/unitykit' instead of lucide-react, so every icon shares the kit's sizes, stroke and accessible naming. If the kit lacks an icon, raise it in UKIT.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === 'lucide-react') {
          context.report({ node, messageId: 'direct' })
        }
      },
    }
  },
}
