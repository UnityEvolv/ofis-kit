import { sep } from 'node:path'

/**
 * A provider's SDK is imported only inside that provider's own adapter.
 *
 * The bundle check catches the size of the mistake; this catches the mistake
 * itself, with the name of the rule it broke. The moment a controls bar imports
 * a provider SDK to ask it a question, every app ships that SDK whether the org
 * uses the provider or not, and swapping providers stops being configuration.
 *
 * ofiskit ships one provider, the built-in peer-to-peer one, which has no SDK —
 * it is browser WebRTC. The rule is here because the interface is here: a
 * wrapper adding LiveKit inherits the check rather than inventing it.
 */
const DEFAULT_SDKS = [
  'livekit-client',
  '@livekit/components-react',
  'livekit-server-sdk',
  '@daily-co/daily-js',
  '@daily-co/react-native-daily-js',
  'agora-rtc-sdk-ng',
  'agora-rtc-react',
  'agora-access-token',
  '@azure/communication-calling',
  '@azure/communication-common',
  'ably',
  'twilio-video',
]

export default {
  meta: {
    type: 'problem',
    docs: {
      description: "Forbid a provider SDK import outside that provider's own adapter directory.",
    },
    schema: [
      {
        type: 'object',
        properties: {
          sdks: { type: 'array', items: { type: 'string' } },
          /**
           * Path fragments that may import an SDK. A fragment matches when it
           * appears in the file's path, so `providers/livekit` allows the
           * LiveKit adapter's own files and nothing else.
           */
          allow: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      outsideAdapter:
        "'{{source}}' is a provider SDK and may only be imported inside that provider's adapter ({{allowed}}). The UI and the call model talk to the provider through the RTC provider interface, never to an SDK.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {}
    const sdks = new Set(options.sdks ?? DEFAULT_SDKS)
    const allow = options.allow ?? ['providers/', 'plugins/rtc/', 'plugins/messaging/']
    const filename = context.filename.split(sep).join('/')

    return {
      ImportDeclaration(node) {
        const source = node.source.value
        if (typeof source !== 'string') return
        // Match the package root so 'livekit-client/dist/x' is caught too.
        const root = source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0]
        if (!sdks.has(root)) return
        if (allow.some((fragment) => filename.includes(fragment))) return
        context.report({
          node,
          messageId: 'outsideAdapter',
          data: { source, allowed: allow.join(', ') },
        })
      },
    }
  },
}
