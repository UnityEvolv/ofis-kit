import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AmbienceControl, type AmbienceControlProps } from './AmbienceControl.js'
import type { AmbienceStatus } from './useAmbience.js'

const cafe = { id: 'cafe', label: 'Café', src: '/ambience/cafe.mp3' }

function draw(status: AmbienceStatus, overrides: Partial<AmbienceControlProps> = {}) {
  const props: AmbienceControlProps = {
    ambience: { status, track: status === 'silent' ? null : cafe, start: vi.fn() },
    enabled: status !== 'off',
    volume: 0.4,
    onEnabledChange: vi.fn(),
    onVolumeChange: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<AmbienceControl {...props} />) }
}

describe('the ambience control', () => {
  it('draws nothing in a room without a loop', () => {
    const { container } = draw('silent')
    expect(container).toBeEmptyDOMElement()
  })

  it('offers to start when the browser is waiting for a press', async () => {
    const { props } = draw('blocked')
    await userEvent.click(screen.getByRole('button', { name: 'Play Café ambience' }))
    expect(props.ambience.start).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('This room has Café ambience')
  })

  it('says what is playing in words, not by colour', () => {
    draw('playing')
    expect(
      screen.getByRole('button', { name: 'Café ambience: Playing. Ambience settings' }),
    ).toBeInTheDocument()
  })

  it('still shows the room’s loop to somebody who has it off', () => {
    draw('off')
    expect(screen.getByRole('button', { name: /Café ambience: Off for you/ })).toBeInTheDocument()
  })

  it('says it is paused during a call', () => {
    draw('paused')
    expect(screen.getByRole('button', { name: /Paused for the call/ })).toBeInTheDocument()
  })

  it('holds the person’s switch and volume', async () => {
    const { props } = draw('playing')
    await userEvent.click(screen.getByRole('button', { name: /Ambience settings/ }))

    await userEvent.click(screen.getByRole('checkbox', { name: /Play room ambience/ }))
    expect(props.onEnabledChange).toHaveBeenCalledWith(false)

    const slider = screen.getByRole('slider', { name: 'Ambience volume' })
    expect(slider).toHaveValue('40')
    fireEvent.change(slider, { target: { value: '70' } })
    expect(props.onVolumeChange).toHaveBeenCalledWith(0.7)
  })

  it('takes the host’s words', () => {
    draw('playing', {
      labels: { playing: 'Spielt', settings: (label, state) => `${label} – ${state}` },
    })
    expect(screen.getByRole('button', { name: 'Café – Spielt' })).toBeInTheDocument()
  })
})
