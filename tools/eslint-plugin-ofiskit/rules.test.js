/**
 * Proof that the boundary checks fail.
 *
 * The repo layout story asks for a failing test per applicable rule, and the
 * reason is worth restating: a lint rule that has never been seen to fail is
 * indistinguishable from one that is not wired up. Each block below is a rule
 * and the mistake it exists to catch.
 */
import { RuleTester } from 'eslint'
import globals from 'globals'
import { describe, it } from 'vitest'
import plugin from './index.js'

// RuleTester drives vitest's globals when handed them, so a rule failure is a
// test failure with the message attached rather than a thrown object.
RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
})

tester.run('no-dom-in-agnostic', plugin.rules['no-dom-in-agnostic'], {
  valid: [
    // navigator and RTCPeerConnection are shimmed by React Native, so they are
    // cross-platform in practice and deliberately allowed.
    { code: 'export const pc = new RTCPeerConnection()' },
    {
      code: 'export async function mic() { return navigator.mediaDevices.getUserMedia({ audio: true }) }',
    },
    // A local binding that happens to be called document is not the DOM.
    { code: 'export function render(document) { return document.title }' },
    { code: "import { io } from 'socket.io-client'\nexport const socket = io()" },
  ],
  invalid: [
    {
      code: 'export const el = document.getElementById("map")',
      errors: [{ messageId: 'domGlobal', data: { name: 'document' } }],
    },
    {
      code: 'export const w = window.innerWidth',
      errors: [{ messageId: 'domGlobal' }],
    },
    {
      code: "import { createRoot } from 'react-dom/client'\nexport { createRoot }",
      errors: [{ messageId: 'domModule' }],
    },
    {
      code: 'export const saved = localStorage.getItem("theme")',
      errors: [{ messageId: 'domGlobal' }],
    },
    // By the longer road, through the global object.
    {
      code: 'export const el = globalThis.document.body',
      errors: [{ messageId: 'domGlobal', data: { name: 'document' } }],
    },
  ],
})

/**
 * The same rule where the globals are configured, which is how the workspace
 * actually runs it.
 *
 * With `globals.browser` or `globals.node` in the configuration, a DOM global is
 * not an unresolved reference any more: it resolves to the configured global. A
 * rule that only looked at unresolved references passed every case below, which
 * is to say it was not running at all in the packages it was written for.
 */
tester.run(
  'no-dom-in-agnostic, with browser globals configured',
  plugin.rules['no-dom-in-agnostic'],
  {
    valid: [
      {
        code: 'export const pc = new RTCPeerConnection()',
        languageOptions: { globals: { ...globals.browser } },
      },
      {
        code: 'export const devices = () => navigator.mediaDevices.enumerateDevices()',
        languageOptions: { globals: { ...globals.browser } },
      },
      {
        // Declared here, so it is this file's own and not the DOM's.
        code: 'const document = { title: "" }\nexport const title = document.title',
        languageOptions: { globals: { ...globals.browser } },
      },
      {
        code: 'export function render(window) { return window.innerWidth }',
        languageOptions: { globals: { ...globals.browser } },
      },
    ],
    invalid: [
      {
        code: 'export const el = document.getElementById("map")',
        languageOptions: { globals: { ...globals.browser } },
        errors: [{ messageId: 'domGlobal', data: { name: 'document' } }],
      },
      {
        code: 'export const width = () => window.innerWidth',
        languageOptions: { globals: { ...globals.browser } },
        errors: [{ messageId: 'domGlobal', data: { name: 'window' } }],
      },
      {
        code: 'export function theme() { return localStorage.getItem("theme") }',
        languageOptions: { globals: { ...globals.node } },
        errors: [{ messageId: 'domGlobal', data: { name: 'localStorage' } }],
      },
      {
        code: 'export const dark = () => matchMedia("(prefers-color-scheme: dark)").matches',
        languageOptions: { globals: { ...globals.browser, ...globals.node } },
        errors: [{ messageId: 'domGlobal', data: { name: 'matchMedia' } }],
      },
    ],
  },
)

tester.run('no-hostname-literal', plugin.rules['no-hostname-literal'], {
  valid: [
    { code: 'export const url = config.publicBaseUrl' },
    { code: 'export const join = (base, id) => new URL(`/office/${id}`, base).toString()' },
    // Not product hostnames, and not anything anyone will reconfigure.
    { code: 'export const NS = "http://www.w3.org/2000/svg"' },
    { code: 'export const licence = "https://www.gnu.org/licenses/agpl-3.0.html"' },
  ],
  invalid: [
    {
      code: 'export const site = "https://unityofis.unityevolv.com"',
      errors: [{ messageId: 'productHost' }],
    },
    {
      code: 'export const demo = `https://demo.ofiskit.dev/office/${id}`',
      errors: [{ messageId: 'productHost' }],
    },
    {
      code: 'export const socketUrl = "http://localhost:4000"',
      errors: [{ messageId: 'localOrigin' }],
    },
  ],
})

tester.run('no-provider-sdk-outside-adapter', plugin.rules['no-provider-sdk-outside-adapter'], {
  valid: [
    {
      // Inside its own adapter, which is the one place it belongs.
      filename: '/repo/packages/realtime-client/src/providers/livekit/adapter.ts',
      code: "import { Room } from 'livekit-client'\nexport { Room }",
    },
    {
      filename: '/repo/packages/ui-map/src/CallControls.tsx',
      code: "import { useCall } from '@unityevolv/ofiskit-realtime-client'\nexport { useCall }",
    },
  ],
  invalid: [
    {
      // The mistake: a UI component asking an SDK a question directly. Every
      // app then ships LiveKit whether its org uses it or not.
      filename: '/repo/packages/ui-map/src/CallControls.tsx',
      code: "import { Room } from 'livekit-client'\nexport { Room }",
      errors: [{ messageId: 'outsideAdapter' }],
    },
    {
      filename: '/repo/server/src/calls.ts',
      code: "import { AccessToken } from 'livekit-server-sdk'\nexport { AccessToken }",
      errors: [{ messageId: 'outsideAdapter' }],
    },
  ],
})

tester.run('no-lucide-direct', plugin.rules['no-lucide-direct'], {
  valid: [{ code: "import { Icon } from '@unityevolv/unitykit'\nexport { Icon }" }],
  invalid: [
    {
      code: "import { Lock } from 'lucide-react'\nexport { Lock }",
      errors: [{ messageId: 'direct' }],
    },
  ],
})

tester.run('no-pii-in-logs', plugin.rules['no-pii-in-logs'], {
  valid: [
    { code: 'logger.info({ userId: user.id, roomId }, "joined room")' },
    { code: 'console.warn("move refused", { reason, roomId })' },
    { code: 'logger.debug({ user: user.id }, "reconnected")' },
    // Not a log call at all.
    { code: 'render({ email: user.email })' },
  ],
  invalid: [
    {
      code: 'logger.info({ email: user.email }, "entered office")',
      errors: [{ messageId: 'piiField' }],
    },
    {
      code: 'console.log(`knock from ${user.displayName}`)',
      errors: [{ messageId: 'piiField' }],
    },
    {
      // The whole identity, whose shape the rule cannot see, so all of it.
      code: 'logger.error({ user }, "adapter refused")',
      errors: [{ messageId: 'piiObject' }],
    },
  ],
})
