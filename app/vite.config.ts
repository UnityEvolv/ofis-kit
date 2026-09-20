import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const promptDocument = join(here, '..', 'docs', 'background-prompt.json')

/**
 * Serve the background prompt from the one copy of it.
 *
 * The prompt lives in `docs/` as a versioned document and the builder fetches
 * it, so improving the prompt reaches every author and every host without
 * releasing the builder. This plugin exists so that there is still only one
 * copy: the alternative is a duplicate in `app/public` that drifts, and a
 * drifted prompt is the one thing about this document that would make it
 * worthless.
 */
function backgroundPrompt(): Plugin {
  const served = '/background-prompt.json'

  return {
    name: 'ofiskit:background-prompt',

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== served) return next()
        void readFile(promptDocument, 'utf8').then(
          (body) => {
            response.setHeader('content-type', 'application/json')
            response.end(body)
          },
          () => next(),
        )
      })
    },

    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'background-prompt.json',
        source: await readFile(promptDocument, 'utf8'),
      })
    },
  }
}

/**
 * Two builds from one app.
 *
 * The office needs a live Node process for presence and signalling, so it
 * cannot be static files. The builder and the documentation are entirely
 * client-side, so they can — and that is what goes on Pages, with a link out to
 * wherever the live demo is running.
 *
 * `PAGES_BASE` and `PUBLIC_DEMO_URL` are the only two things that differ, and
 * both are configuration. Nothing in the source names a host, which is what
 * lets somebody build this for their own fork with nothing edited.
 */
export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'

  return {
    plugins: [react(), tailwind(), backgroundPrompt()],
    base: pages ? (process.env.PAGES_BASE ?? '/') : '/',

    define: {
      __PAGES__: JSON.stringify(pages),
      __DEMO_URL__: JSON.stringify(process.env.PUBLIC_DEMO_URL ?? ''),
    },

    build: {
      outDir: pages ? 'dist-pages' : 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          /**
           * The builder is a separate entry on purpose.
           *
           * Somebody opening the builder should not download the call stack,
           * and somebody entering the office should not download the builder.
           * The bundle budget checks both, and it fails if these ever merge.
           */
          manualChunks(id) {
            if (id.includes('ui-builder')) return 'builder'
            return undefined
          },
          chunkFileNames: 'assets/[name]-[hash].js',
        },
      },
    },

  }
})
