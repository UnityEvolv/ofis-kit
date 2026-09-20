import type { CustomStatus, ManualStatus, PublicPresence } from '@unityevolv/ofiskit-realtime-client'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StatusControl } from './StatusControl.js'

/**
 * Where a person sets and sees their own status.
 *
 * Two things are going on at once and the control has to keep them apart: what
 * the office worked out, and what the person chose. These tests are mostly about
 * that distinction, because getting it wrong is what produces somebody stuck on
 * do not disturb with no way back.
 */

function person(overrides: Partial<PublicPresence> = {}): PublicPresence {
  return {
    userId: 'ada',
    displayName: 'Ada',
    roomId: 'reception',
    devices: [
      {
        deviceId: 'laptop',
        kind: 'web',
        inCall: false,
        muted: true,
        cameraOn: false,
        sharing: false,
        speaking: false,
        lastSpokeAt: null,
        handRaisedAt: null,
      },
    ],
    status: 'available',
    arrivedAt: '2026-01-01T09:00:00.000Z',
    ...overrides,
  }
}

async function open(
  options: {
    you?: PublicPresence | null
    chosen?: boolean
    fromBreakRoom?: boolean
    presets?: readonly CustomStatus[]
  } = {},
) {
  const onSetStatus = vi.fn<(manual: ManualStatus | null) => void>()
  const onSetCustom = vi.fn<(custom: CustomStatus | null) => void>()
  const user = userEvent.setup()

  render(
    <StatusControl
      you={options.you === undefined ? person() : options.you}
      chosen={options.chosen ?? false}
      fromBreakRoom={options.fromBreakRoom ?? false}
      {...(options.presets ? { presets: options.presets } : {})}
      onSetStatus={onSetStatus}
      onSetCustom={onSetCustom}
    />,
  )

  await user.click(screen.getByRole('button', { name: /your status/i }))
  return { user, onSetStatus, onSetCustom }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the status control', () => {
  it('shows the status somebody is showing, and says it is theirs to change', () => {
    render(
      <StatusControl
        you={person({ status: 'dnd' })}
        chosen
        fromBreakRoom={false}
        onSetStatus={() => {}}
        onSetCustom={() => {}}
      />,
    )

    expect(
      screen.getByRole('button', { name: /your status: do not disturb\. change it\./i }),
    ).toBeInTheDocument()
  })

  it('offers the three choices a person can make', async () => {
    await open()

    for (const label of ['Available', 'Away', 'Do not disturb']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('sets a chosen status', async () => {
    const { user, onSetStatus } = await open()
    await user.click(screen.getByRole('button', { name: 'Do not disturb' }))
    expect(onSetStatus).toHaveBeenCalledWith('dnd')
  })

  it('offers a way back to automatic when a status was chosen', async () => {
    // A chosen status wins over everything the office works out, so there has to
    // be a visible way out of it.
    const { user, onSetStatus } = await open({ chosen: true, you: person({ status: 'dnd' }) })

    await user.click(screen.getByRole('button', { name: /automatically/i }))
    expect(onSetStatus).toHaveBeenCalledWith(null)
  })

  it('offers no way back when nothing was chosen', async () => {
    // It would be a control that does nothing, next to a status the person never
    // set — which reads as though they had.
    await open({ chosen: false })
    expect(screen.queryByRole('button', { name: /automatically/i })).not.toBeInTheDocument()
  })

  it('marks which choice is in force when the person made it', async () => {
    await open({ chosen: true, you: person({ status: 'away' }) })
    expect(screen.getByRole('button', { name: 'Away' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not mark a worked-out status as a choice', async () => {
    // Ten idle minutes shows somebody as away. That is not the same as choosing
    // it, and the control must not claim they did.
    await open({ chosen: false, you: person({ status: 'away' }) })
    expect(screen.getByRole('button', { name: 'Away' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('explains do not disturb that came from the break room, quietly', async () => {
    // Surfaced in the control rather than as a notification: being told "you are
    // now unavailable" is the kind of interruption this product exists to avoid.
    await open({ fromBreakRoom: true, you: person({ status: 'dnd', roomId: 'break' }) })

    expect(screen.getByText(/because you are in the break room/i)).toBeInTheDocument()
    expect(screen.getByText(/knocks still arrive, silently/i)).toBeInTheDocument()
  })

  it('sets a custom status with an emoji and an expiry the client worked out', async () => {
    vi.setSystemTime(new Date('2026-03-01T10:00:00.000Z'))
    const { user, onSetCustom } = await open()

    await user.type(screen.getByRole('textbox', { name: /emoji/i }), '🥪')
    await user.type(screen.getByRole('textbox', { name: /what is your status/i }), 'Lunch')
    await user.selectOptions(screen.getByRole('combobox', { name: /clear it/i }), '1h')
    await user.click(screen.getByRole('button', { name: /set status/i }))

    const custom = onSetCustom.mock.calls[0]?.[0]
    expect(custom).toMatchObject({ text: 'Lunch', emoji: '🥪' })

    // An absolute instant, because the server never computes a date in anybody's
    // time zone — it only compares two of them.
    expect(Date.parse(custom?.expiresAt ?? '')).toBeCloseTo(
      Date.parse('2026-03-01T11:00:00.000Z'),
      -3,
    )
  })

  it('sends no expiry at all for "until I clear it"', async () => {
    const { user, onSetCustom } = await open()

    await user.type(screen.getByRole('textbox', { name: /what is your status/i }), 'On leave')
    await user.selectOptions(screen.getByRole('combobox', { name: /clear it/i }), 'never')
    await user.click(screen.getByRole('button', { name: /set status/i }))

    expect(onSetCustom.mock.calls[0]?.[0]?.expiresAt).toBeUndefined()
  })

  it('works out the end of today in the viewer’s own zone', async () => {
    // Where "today" ends depends on where the person is, which is exactly why the
    // client decides it and the server is only ever handed an instant.
    const { user, onSetCustom } = await open()

    await user.type(screen.getByRole('textbox', { name: /what is your status/i }), 'Out')
    await user.selectOptions(screen.getByRole('combobox', { name: /clear it/i }), 'today')
    await user.click(screen.getByRole('button', { name: /set status/i }))

    const expiresAt = new Date(onSetCustom.mock.calls[0]?.[0]?.expiresAt ?? 0)
    expect(expiresAt.getHours()).toBe(23)
    expect(expiresAt.getMinutes()).toBe(59)
  })

  it('refuses to set a custom status with no words', async () => {
    const { user } = await open()
    expect(screen.getByRole('button', { name: /set status/i })).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: /what is your status/i }), 'Something')
    expect(screen.getByRole('button', { name: /set status/i })).toBeEnabled()
  })

  it('shows when a custom status will clear, so nobody is surprised by it going', async () => {
    // The only complaint this feature ever gets.
    await open({
      you: person({
        custom: { text: 'Lunch', expiresAt: new Date(Date.now() + 3600_000).toISOString() },
      }),
    })

    expect(screen.getByText(/clears at /i)).toBeInTheDocument()
  })

  it('offers a way to clear a custom status only while there is one', async () => {
    const withOne = await open({ you: person({ custom: { text: 'Lunch' } }) })
    await withOne.user.click(screen.getByRole('button', { name: /^clear$/i }))
    expect(withOne.onSetCustom).toHaveBeenCalledWith(null)
  })

  it('shows the custom status in place of the plain one on the trigger', () => {
    render(
      <StatusControl
        you={person({ custom: { text: 'Lunch', emoji: '🥪' } })}
        chosen={false}
        fromBreakRoom={false}
        onSetStatus={() => {}}
        onSetCustom={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: /your status: available, lunch/i })).toHaveTextContent(
      '🥪 Lunch',
    )
  })

  it('shows no presets in an office that has none', async () => {
    // The free office has none. unityofis passes its org's, and they come first.
    await open()
    expect(screen.queryByRole('button', { name: /🍽/ })).not.toBeInTheDocument()
  })

  it('sets a preset in one click where a host supplies them', async () => {
    const presets = [{ text: 'In a workshop', emoji: '🛠' }]
    const { user, onSetCustom } = await open({ presets })

    await user.click(screen.getByRole('button', { name: /in a workshop/i }))
    expect(onSetCustom).toHaveBeenCalledWith(presets[0])
  })
})
