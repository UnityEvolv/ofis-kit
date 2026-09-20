import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'vite'

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
    plugins: [react(), tailwind()],
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
