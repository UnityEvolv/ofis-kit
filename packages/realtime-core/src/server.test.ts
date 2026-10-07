import { describe, expect, it } from 'vitest'

import { originAllowed } from './server.js'

/**
 * Who may open a socket.
 *
 * An empty list is documented as same-origin only, and used to mean any origin
 * at all: CORS was the only check, and a WebSocket is not subject to CORS. These
 * are the answers the check gives now, without standing up a server to ask.
 */
describe('the origin check', () => {
  it('lets the page the socket is served from connect, with no list at all', () => {
    expect(originAllowed('https://office.example.com', 'office.example.com', [])).toBe(true)
    expect(originAllowed('http://localhost:4000', 'localhost:4000', [])).toBe(true)
  })

  it('refuses any other page when the list is empty', () => {
    expect(originAllowed('https://evil.example', 'office.example.com', [])).toBe(false)
    expect(originAllowed('http://localhost:5000', 'localhost:4000', [])).toBe(false)
    // A sandboxed frame or a file says "null", which is nobody's origin.
    expect(originAllowed('null', 'office.example.com', [])).toBe(false)
  })

  it('tolerates a proxy that forwards the host without its port, and nothing looser', () => {
    // nginx's $host drops the port; the name still has to be the same name.
    expect(originAllowed('http://localhost:8080', 'localhost', [])).toBe(true)
    expect(originAllowed('http://elsewhere:8080', 'localhost', [])).toBe(false)
  })

  it('lets the configured origins in as well as its own, and only those', () => {
    const allowed = ['https://app.example.com']
    expect(originAllowed('https://app.example.com', 'office.example.com', allowed)).toBe(true)
    expect(originAllowed('https://office.example.com', 'office.example.com', allowed)).toBe(true)
    expect(originAllowed('https://evil.example', 'office.example.com', allowed)).toBe(false)
  })

  it('lets a request with no Origin through, which no browser sends cross-origin', () => {
    expect(originAllowed(undefined, 'office.example.com', [])).toBe(true)
  })
})
