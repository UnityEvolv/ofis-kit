import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end, including a real call.
 *
 * The call tests are the reason this exists. Everything else about the office
 * can be checked by a component test; a call cannot, because the thing that
 * breaks is two browsers failing to agree on a connection, and that only
 * happens when there are two browsers.
 *
 * Chromium is launched with fake camera and microphone devices, so
 * `getUserMedia` succeeds on a machine with no hardware and the fake microphone
 * produces a known tone. That is what makes a call test possible in CI at all —
 * and it needs no credentials, which is why it can run on a public repository.
 */

const PORT = Number(process.env.E2E_PORT ?? 4173)

/** Fake devices, and no permission prompt to click. */
const FAKE_MEDIA = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  // Without this, a headless Chromium will not generate host candidates for a
  // loopback connection and two tabs on one machine never connect.
  '--allow-loopback-in-peer-connection',
]

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'office',
      testMatch: /office\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], launchOptions: { args: FAKE_MEDIA } },
    },
    {
      name: 'calls',
      testMatch: /call\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], launchOptions: { args: FAKE_MEDIA } },
    },
    {
      // Run separately by `npm run test:a11y`, on every page and both themes.
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], launchOptions: { args: FAKE_MEDIA } },
    },
  ],

  /**
   * The real server, serving the real built app.
   *
   * Not a dev server: the thing worth testing is what a person would actually
   * run, and a Vite dev server is not that.
   */
  webServer: {
    command: 'node server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      APP_DIR: 'app/dist',
      CONFIG_DIR: 'config',
      LOG_LEVEL: 'warn',
      TURN_SECRET: 'e2e-secret',
      // A person disappearing is worth watching for; thirty seconds of it in
      // every run is not. The behaviour is the same, the wait is not.
      PRESENCE_GRACE_MS: '2000',
      // No TURN URLs: two tabs on one machine connect directly, and the
      // compose file's coturn is what the CI job adds for the relayed path.
      TURN_URLS: process.env.TURN_URLS ?? '',
      STUN_URLS: process.env.STUN_URLS ?? '',
    },
  },
})
