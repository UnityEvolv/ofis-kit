import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'

import {
  fileTemplateSource,
  memoryRateLimiter,
  typedEmailIdentity,
} from '@unityevolv/ofiskit-adapters'
import { MemoryPresenceStore } from '@unityevolv/ofiskit-presence-store'
import {
  builtInProvider,
  createLogger,
  createRealtimeServer,
  iceServersFor,
} from '@unityevolv/ofiskit-realtime-core'

import { loadConfig, publicConfig } from './config.js'

/**
 * The single-office host.
 *
 * Everything below is configuration: the engine with the in-memory presence
 * store, the typed-email identity adapter, the template read off disk, and the
 * built-in peer-to-peer provider. unityofis runs the same engine with Redis, a
 * membership adapter and a database template source, and adds no code to it.
 *
 * Read this file to see where the boundary is. It is about a hundred lines, and
 * that is the whole difference between a free office and a product.
 */

const config = loadConfig()
const logger = createLogger({ level: config.logLevel })

const store = new MemoryPresenceStore()
const templates = fileTemplateSource({
  path: config.templatePath,
  imageBase: '/office',
  watch: config.watchTemplate,
})

const http = createServer((request, response) => {
  void serve(request, response)
})

const realtime = createRealtimeServer({
  httpServer: http,
  officeId: config.officeId,
  store,
  identity: typedEmailIdentity(),
  // One process, so a Map is the whole answer. unityofis passes its own limiter,
  // which counts somewhere every node can see.
  limiter: memoryRateLimiter(),
  /*
   * Peer-to-peer, and the only provider here.
   *
   * Four participants, audio, video and screen share, no server-side recording —
   * because there is no server to record on, which is exactly why it is the free
   * tier. A host with an SFU passes its own plugin here and changes nothing else.
   */
  provider: builtInProvider({
    /*
     * The relay, minted per call join.
     *
     * The provider asks for ICE servers rather than knowing about a relay, which
     * is what keeps "what carries the media" and "how a client gets through a
     * firewall" as two separate decisions — an SFU provider would supply its own
     * and this line would be the only thing that changed.
     *
     * The identifier goes into the credential's username, so a relay log ties
     * back to a call leg without this process keeping a table of who was issued
     * what. There is no such table, because there is no database.
     */
    iceServersFor: (context) =>
      iceServersFor(config.turn, `${context.callId}:${context.deviceId}`),
  }),
  // No call hooks: there is no database to write a record to. unityofis binds
  // them and gets a record per call and per leg without the engine knowing.

  templates,
  logger,
  graceMs: config.graceMs,
  ...(config.allowedOrigins.length > 0 ? { allowedOrigins: config.allowedOrigins } : {}),

})

/**
 * Media types for what this server serves: the built app, and the office.
 *
 * A short explicit list rather than a dependency. Anything not here is served
 * as a download rather than guessed at, which is the safe way round.
 */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<unknown> {
  const url = new URL(request.url ?? '/', 'http://placeholder')

  if (url.pathname === '/healthz') {
    return json(response, 200, await realtime.health())
  }

  // The app ships with no hostnames in it and asks where things are.
  if (url.pathname === '/config') {
    return json(response, 200, publicConfig(config))
  }

  if (url.pathname === '/v1/office') {
    // The office state over HTTP: the same view the map gets, for a host that
    // wants to read it without opening a socket.
    return json(response, 200, await realtime.engine.readOffice())
  }

  if (url.pathname === '/v1/template') {
    const template = await templates.get(config.officeId)
    return template ? json(response, 200, template) : json(response, 404, { code: 'office.unknown', message: 'No office here.' })
  }

  // The background image, from the config folder beside template.json.
  if (url.pathname.startsWith('/office/')) {
    return file(response, config.configDir, url.pathname.slice('/office/'.length))
  }

  // The built app, from this same origin as everything above it.
  const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
  if (await file(response, config.appDir, asset, { quiet: true })) return

  /*
   * Anything else is the app's own routing.
   *
   * `/builder` is a path the client knows what to do with and the server has
   * never heard of, so it gets index.html and the app takes it from there. An
   * asset request is excluded by its extension: a missing script answered with a
   * page of HTML is a confusing failure, and a 404 is the honest one.
   */
  if (!extname(url.pathname)) {
    if (await file(response, config.appDir, 'index.html', { quiet: true })) return
  }

  json(response, 404, { code: 'not_found', message: 'Nothing here.' })
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

/**
 * Serve one file from inside one directory.
 *
 * Returns false when there is nothing there, so a caller can fall through to
 * the app's own routing rather than the request ending in a 404 for a path the
 * client knows perfectly well what to do with.
 */
async function file(
  response: ServerResponse,
  root: string,
  name: string,
  options: { quiet?: boolean } = {},
): Promise<boolean> {
  // Resolve, then check it is still inside the directory we meant. These two
  // directories are the only places this process reads from disk, and it should
  // stay that way whatever arrives in a URL.
  //
  // Compared with `relative` rather than `startsWith`, because a prefix match
  // says that /app/config-backup is inside /app/config. The WHATWG URL parser
  // has usually already removed `..` segments by this point; this is the check
  // that does not depend on it having done so.
  const path = resolve(join(root, normalize(name)))
  const inside = relative(root, path)
  if (inside.startsWith('..') || isAbsolute(inside)) {
    json(response, 403, { code: 'forbidden', message: 'Not that.' })
    return true
  }

  const found = await stat(path).catch(() => null)
  if (!found?.isFile()) {
    if (options.quiet) return false
    json(response, 404, { code: 'not_found', message: 'Nothing here.' })
    return true
  }

  const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  response.writeHead(200, {
    'content-type': type,
    'content-length': found.size,
    // Hashed assets never change, so they can be cached hard. index.html is the
    // thing that points at them, so it must not be.
    'cache-control': path.includes('assets') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
  })
  createReadStream(path).pipe(response)
  return true
}

http.listen(config.port, config.host, () => {
  logger.info('office open', { port: config.port, officeId: config.officeId })
})

/**
 * Stop cleanly.
 *
 * Flush what the engine is holding, tell the sockets, then close. A process
 * that vanishes leaves every client reconnecting to nothing and every avatar
 * standing in a room until the presence TTL catches up.
 */
let closing = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return
    closing = true
    logger.info('closing', { code: signal })

    void realtime
      .close()
      .then(() => new Promise<void>((done) => http.close(() => done())))
      .then(() => process.exit(0))
      .catch(() => process.exit(1))

    // A shutdown that hangs is worse than an abrupt one.
    setTimeout(() => process.exit(1), 8000).unref()
  })
}
