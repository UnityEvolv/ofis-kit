import { describe, expect, it } from 'vitest'

import { NUDGE_DEFAULTS, cleanNudgeLine, nudgeDelivery } from './nudge.js'
import { NUDGE_LINE_MAX, Refusal } from './protocol/index.js'

describe('what a status does to a nudge', () => {
  it('goes straight to somebody available', () => {
    expect(nudgeDelivery('available', 'Priya')).toBe('now')
  })

  it('is held for somebody in a call or a meeting, never interrupting it', () => {
    expect(nudgeDelivery('in_call', 'Priya')).toBe('held')
    expect(nudgeDelivery('in_meeting', 'Priya')).toBe('held')
  })

  it('is refused, by name, for do not disturb, away, and not connected', () => {
    expect(nudgeDelivery('dnd', 'Priya')).toEqual({
      code: Refusal.NUDGE_DND,
      message: 'Priya is on do not disturb, so the nudge was not sent.',
    })
    expect(nudgeDelivery('away', 'Priya')).toMatchObject({ code: Refusal.NUDGE_AWAY })
    expect(nudgeDelivery('offline', 'Priya')).toMatchObject({ code: Refusal.NUDGE_OFFLINE })
    expect(nudgeDelivery('reconnecting', 'Priya')).toMatchObject({ code: Refusal.NUDGE_OFFLINE })
  })
})

describe('the line', () => {
  it('is optional, and blank is the same as none', () => {
    expect(cleanNudgeLine(undefined)).toBeUndefined()
    expect(cleanNudgeLine(null)).toBeUndefined()
    expect(cleanNudgeLine(' \n\t ')).toBeUndefined()
  })

  it('is folded to one line', () => {
    expect(cleanNudgeLine('got\n\na   minute?')).toBe('got a minute?')
  })

  it('is at most a tweet long, counted in characters a person sees', () => {
    expect(cleanNudgeLine('x'.repeat(NUDGE_LINE_MAX))).toHaveLength(NUDGE_LINE_MAX)
    expect(cleanNudgeLine('x'.repeat(NUDGE_LINE_MAX + 1))).toBeNull()
    expect(cleanNudgeLine('👋'.repeat(NUDGE_LINE_MAX))).not.toBeNull()
  })

  it('refuses anything that is not text', () => {
    expect(cleanNudgeLine(42)).toBeNull()
    expect(cleanNudgeLine({ ops: [] })).toBeNull()
    expect(cleanNudgeLine('ring\u0007')).toBeNull()
  })
})

it('has the decided defaults: three a minute to one person, ten overall', () => {
  expect(NUDGE_DEFAULTS).toEqual({
    perPersonLimit: 3,
    perPersonWindowMs: 60_000,
    perSenderLimit: 10,
    perSenderWindowMs: 60_000,
  })
})
