/**
 * Proof that the boundary checks fail.
 *
 * The repo layout story asks for a failing test per applicable rule, and the
 * reason is worth restating: a lint rule that has never been seen to fail is
 * indistinguishable from one that is not wired up. Each block below is a rule
 * and the mistake it exists to catch.
 */
import { RuleTester } from 'eslint'
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
    { code: 'export async function mic() { return navigator.mediaDevices.getUserMedia({ audio: true }) }' },
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
  ],
})

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
