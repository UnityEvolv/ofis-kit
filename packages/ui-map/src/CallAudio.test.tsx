import type { ClientEvent, OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CallAudio } from './CallAudio.js'

/**
 * The element that makes a call audible.
 *
 * Worth testing precisely because its absence is invisible: the peer connections
 * succeed, the tiles appear, the indicators move, and nobody can hear anybody. A
 * stream that is never attached to an element is a stream the browser does not
 * play, and no error is raised anywhere.
 */

/** A client whose only job is to hand out rtc events on demand. */
function fakeClient() {
  const listeners = new Set<(event: ClientEvent) => void>()
  const client = {
    on(listener: (event: ClientEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } as unknown as OfisClient

  return {
    client,
    fire(event: ClientEvent) {
      act(() => {
        for (const listener of [...listeners]) listener(event)
      })
    },
  }
}

const audioStream = () => ({ id: 'stream' }) as MediaStream

describe('the call audio', () => {
  it('plays nothing until somebody is talking', () => {
    const { client } = fakeClient()
    const { container } = render(<CallAudio client={client} />)
    expect(container.querySelectorAll('audio')).toHaveLength(0)
  })

  it('attaches an audio track to an element that plays by itself', () => {
    const { client, fire } = fakeClient()
    const { container } = render(<CallAudio client={client} />)
    const stream = audioStream()

    fire({
      type: 'rtc',
      event: { type: 'track', deviceId: 'grace-laptop', stream, source: 'audio' },
    })

    const element = container.querySelector('audio')
    expect(element).not.toBeNull()
    // Autoplay and not muted. A muted audio element is the single easiest way to
    // ship a call nobody can hear.
    expect(element?.autoplay).toBe(true)
    expect(element?.muted).toBe(false)
    expect(element?.srcObject).toBe(stream)
  })

  it('ignores a camera track, which is the tiles’ business', () => {
    const { client, fire } = fakeClient()
    const { container } = render(<CallAudio client={client} />)

    fire({
      type: 'rtc',
      event: { type: 'track', deviceId: 'grace-laptop', stream: audioStream(), source: 'camera' },
    })

    expect(container.querySelectorAll('audio')).toHaveLength(0)
  })

  it('keeps one element per peer, so output can be routed per element', () => {
    const { client, fire } = fakeClient()
    const { container } = render(<CallAudio client={client} />)

    for (const deviceId of ['grace-laptop', 'alan-laptop']) {
      fire({
        type: 'rtc',
        event: { type: 'track', deviceId, stream: audioStream(), source: 'audio' },
      })
    }

    expect(container.querySelectorAll('audio')).toHaveLength(2)
  })

  it('takes the element away when the leg goes', () => {
    // Otherwise a call that ended leaves elements holding dead streams.
    const { client, fire } = fakeClient()
    const { container } = render(<CallAudio client={client} />)

    fire({
      type: 'rtc',
      event: { type: 'track', deviceId: 'grace-laptop', stream: audioStream(), source: 'audio' },
    })
    fire({ type: 'rtc', event: { type: 'participant.left', deviceId: 'grace-laptop' } })

    expect(container.querySelectorAll('audio')).toHaveLength(0)
  })

  it('routes to the chosen speaker, where the browser can', () => {
    const setSinkId = vi.fn(async () => {})
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', {
      configurable: true,
      writable: true,
      value: setSinkId,
    })

    const { client, fire } = fakeClient()
    render(<CallAudio client={client} speakerDeviceId="headphones" />)

    fire({
      type: 'rtc',
      event: { type: 'track', deviceId: 'grace-laptop', stream: audioStream(), source: 'audio' },
    })

    // Per element rather than mixed, which is what lets a call go to headphones
    // while system sounds stay on the speakers.
    expect(setSinkId).toHaveBeenCalledWith('headphones')
  })

  it('falls back to the system default where the browser has no routing', () => {
    // Safari has never had `setSinkId`, and a phone lets the operating system
    // decide — which is the right answer on a phone anyway.
    Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId')

    const { client, fire } = fakeClient()
    const { container } = render(<CallAudio client={client} speakerDeviceId="headphones" />)

    expect(() =>
      fire({
        type: 'rtc',
        event: { type: 'track', deviceId: 'grace-laptop', stream: audioStream(), source: 'audio' },
      }),
    ).not.toThrow()
    expect(container.querySelectorAll('audio')).toHaveLength(1)
  })
})
