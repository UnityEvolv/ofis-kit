import { copyFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const promptDocument = join(here, '..', 'docs', 'background-prompt.json')
const configDir = join(here, '..', 'config')

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
 * The office's pictures, for the Pages build, which has no server to serve them.
 *
 * The server serves whatever `config/template.json` names from `/office/`. Here
 * the same files are copied to the same path, so the app asks for them in the
 * same place either way. Read from the template, so replacing the office in
 * `config/` replaces the demo's too, with nothing to keep in step.
 */
function officeImages(): Plugin {
  return {
    name: 'ofiskit:office-images',
    async generateBundle() {
      const template = JSON.parse(await readFile(join(configDir, 'template.json'), 'utf8')) as {
        images: { light: string; dark?: string }
      }
      const names = new Set([template.images.light, template.images.dark].filter(Boolean))
      for (const name of names) {
        this.emitFile({
          type: 'asset',
          fileName: `office/${name}`,
          source: await readFile(join(configDir, name as string)),
        })
      }
    },
  }
}

/**
 * Every path opens the app, on a host that only serves files.
 *
 * GitHub Pages answers a path it has no file for with `404.html`. Making that the
 * app means `/builder`, opened directly or reloaded, reaches the app's own
 * routing instead of a GitHub error page.
 */
function spaFallback(outDir: string): Plugin {
  return {
    name: 'ofiskit:spa-fallback',
    async closeBundle() {
      await copyFile(join(outDir, 'index.html'), join(outDir, '404.html'))
    },
  }
}

/**
 * Two builds from one app.
 *
 * The normal build is served by the Node process, which runs the office. The
 * Pages build is the demo: static files, with the whole office running in the
 * browser (`src/demo/`) because there is no server to run it on — every tab on
 * the device is a person, and nothing leaves it.
 *
 * `PAGES_BASE` is the only thing that differs between hosts, and it is
 * configuration. Nothing in the source names a host, which is what lets somebody
 * build this for their own fork with nothing edited.
 */
export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'

  return {
    plugins: [
      react(),
      tailwind(),
      backgroundPrompt(),
      ...(pages ? [officeImages(), spaFallback(join(here, 'dist-pages'))] : []),
    ],
    base: pages ? (process.env.PAGES_BASE ?? '/') : '/',

    define: {
      __PAGES__: JSON.stringify(pages),
    },

    build: {
      outDir: pages ? 'dist-pages' : 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          /**
           * The builder is a separate download on purpose: somebody entering the
           * office should not pay for a drawing tool they have not opened.
           *
           * That split comes from the dynamic `import()` in App.tsx and nothing
           * else. It used to be a `manualChunks` rule naming anything from
           * ui-builder, which inverted the whole arrangement — rollup put every
           * shared dependency, React and the kit included, into the chunk that
           * rule had named, and made the entry chunk import it. The budget then
           * reported an app shell of 86 kB that could not run without another
           * 52 kB of "builder", and opening the office downloaded both.
           *
           * So the chunk is named after what is actually in it, which keeps the
           * budget's line about the builder honest and leaves the splitting to
           * the one thing that gets it right.
           */
          chunkFileNames(chunk) {
            const builder = chunk.moduleIds.some((id) => id.includes('ui-builder'))
            return builder ? 'assets/builder-[hash].js' : 'assets/[name]-[hash].js'
          },
        },
      },
    },

    server: {
      /*
       * The server is a separate process in development, on a port of its own.
       *
       * In production the same origin serves both, so none of this applies and no
       * origin is baked into the bundle — which is why the app asks `/config`
       * where things are rather than being told at build time.
       */
      proxy: {
        '/socket': { target: 'http://localhost:4000', ws: true },
        '/config': 'http://localhost:4000',
        '/office': 'http://localhost:4000',
        '/v1': 'http://localhost:4000',
      },
    },
  }
})
