import type { DeviceKind, PublicPresence, Status } from '@unityevolv/ofiskit-realtime-client'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PersonAvatar } from './PersonAvatar.js'
import { STATUS_LOOKS, StatusDot, describeStatus, statusLabel } from './status.js'

/**
 * How a person is drawn, and what a screen reader hears instead.
 *
 * Drawing is not telling: every badge in the corner of an avatar is invisible to
 * a screen reader unless it is in the label, and status is the whole reason
 * somebody decides whether to walk into a room. So these tests read the label.
 */

/**
 * A device with nothing happening on it, which is the ordinary case.
 *
 * A helper because the call fields are required and almost never the point of the
 * test: a fixture spelling out five falses is noise around the one field that
 * matters.
 */
function device(deviceId: string, kind: DeviceKind = 'web'): PublicPresence['devices'][number] {
  return {
    deviceId,
    kind,
    inCall: false,
    muted: true,
    cameraOn: false,
    sharing: false,
    speaking: false,
    lastSpokeAt: null,
  }
}

function person(overrides: Partial<PublicPresence> & { userId: string }): PublicPresence {
  return {
    displayName: overrides.userId,
    roomId: 'studio',
    devices: [device(`${overrides.userId}-laptop`)],
    status: 'available',
    arrivedAt: '2026-01-01T09:00:00.000Z',
    ...overrides,
  }
}

describe('one person on the map', () => {
  it('carries the name and the status in one label', () => {
    render(<PersonAvatar person={person({ userId: 'ada', displayName: 'Ada L' })} size={64} />)
    expect(screen.getByRole('img', { name: 'Ada L, Available' })).toBeInTheDocument()
  })

  it('uses initials when there is no photo, and the photo when there is', () => {
    const { container, unmount } = render(
      <PersonAvatar person={person({ userId: 'ada', displayName: 'Ada Lovelace' })} size={64} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('AL')).toBeInTheDocument()
    unmount()

    render(
      <PersonAvatar
        person={person({ userId: 'ada', photoUrl: 'https://example.test/a.png' })}
        size={64}
      />,
    )
    // Empty alt: the label on the wrapper already names the person, and a second
    // announcement of the same name is noise.
    const photo = screen.getByRole('img', { name: /^ada,/i }).querySelector('img')
    expect(photo).toHaveAttribute('alt', '')
  })

  it('badges somebody who is only on a phone, and says so in the label', () => {
    // The badge is the only way to tell, because presence is per user.
    render(
      <PersonAvatar
        person={person({ userId: 'ada', devices: [device('p', 'mobile')] })}
        size={64}
      />,
    )
    expect(screen.getByRole('img', { name: /on a phone/i })).toBeInTheDocument()
  })

  it('does not badge somebody who also has a laptop open', () => {
    // With a laptop among their devices it would say nothing useful.
    render(
      <PersonAvatar
        person={person({
          userId: 'ada',
          devices: [
            device('p', 'mobile'),
            device('l'),
          ],
        })}
        size={64}
      />,
    )
    expect(screen.queryByRole('img', { name: /on a phone/i })).not.toBeInTheDocument()
  })

  it('shows somebody reconnecting as faded rather than gone', () => {
    // Subtle on purpose: a wifi blip is not a departure, and drawing it as one
    // makes the office flicker every time somebody goes into a tunnel.
    render(<PersonAvatar person={person({ userId: 'ada', status: 'reconnecting' })} size={64} />)

    const avatar = screen.getByRole('img', { name: /reconnecting/i })
    expect(avatar.querySelector('.opacity-50')).not.toBeNull()
  })

  it('says a custom status in the label as well as on hover', () => {
    render(
      <PersonAvatar
        person={person({ userId: 'ada', custom: { text: 'Back at three', emoji: '🥪' } })}
        size={64}
      />,
    )

    // On hover on the web, so the map is not covered in text — and in the label
    // either way, because hover is not available to everybody.
    expect(
      screen.getByRole('img', { name: /Available — 🥪 Back at three/ }),
    ).toBeInTheDocument()
  })

  it('marks one of a linked pair as the same person, not a second colleague', () => {
    render(
      <PersonAvatar
        person={person({
          userId: 'ada',
          devices: [
            device('laptop'),
            device('phone', 'mobile'),
          ],
        })}
        size={64}
        deviceId="phone"
        linked
      />,
    )

    expect(
      screen.getByRole('img', { name: /also here on another device \(this one is mobile\)/i }),
    ).toBeInTheDocument()
  })

  it('becomes a button only when there is something to click', () => {
    const { unmount } = render(<PersonAvatar person={person({ userId: 'ada' })} size={64} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    unmount()

    render(<PersonAvatar person={person({ userId: 'ada' })} size={64} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: /^ada,/i })).toBeInTheDocument()
  })
})

describe('the one visual language for status', () => {
  const every = Object.keys(STATUS_LOOKS) as Status[]

  it('has a look for every status the engine can resolve', () => {
    expect(every).toEqual(
      expect.arrayContaining([
        'available',
        'away',
        'dnd',
        'in_call',
        'in_meeting',
        'reconnecting',
        'offline',
      ]),
    )
  })

  it('conveys nothing by colour alone', () => {
    // Every status is a different shape as well as a different colour, so it
    // survives being looked at by somebody who cannot tell green from amber, and
    // survives a projector that eats saturation.
    const shapes = new Set(every.map((status) => JSON.stringify(STATUS_LOOKS[status].shape)))
    expect(shapes.size).toBe(every.length)
  })

  it('takes its colours from tokens rather than naming one', () => {
    for (const status of every) {
      expect(STATUS_LOOKS[status].tone).toMatch(/^text-/)
      expect(STATUS_LOOKS[status].tone).not.toMatch(/#|rgb|hsl/)
    }
  })

  it('names the status for assistive technology where the dot is the only thing saying it', () => {
    const { unmount } = render(<StatusDot status="dnd" />)
    expect(screen.getByRole('img', { name: 'Do not disturb' })).toBeInTheDocument()
    unmount()

    // And stays quiet where the surrounding text already says it, rather than
    // reading the same word twice.
    const { container } = render(<StatusDot status="dnd" labelled={false} />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('words a status the same way everywhere it appears', () => {
    // One sentence, built in one place, so the map, the list and a tile never
    // word it differently.
    expect(statusLabel('in_call')).toBe('In a call')
    expect(describeStatus('in_call')).toBe('In a call')
    expect(describeStatus('away', { text: 'Lunch' })).toBe('Away — Lunch')
    expect(describeStatus('away', { text: 'Lunch', emoji: '🥪' })).toBe('Away — 🥪 Lunch')
  })
})
