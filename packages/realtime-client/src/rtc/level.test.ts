import { describe, expect, it } from 'vitest'

import { SPEAKING_HOLD_MS, SPEAKING_LEVEL, rmsLevel, speakingNow } from './adapter.js'

/**
 * The one number the speaking indicator depends on.
 *
 * Worth testing on its own because getting it wrong is invisible: the call works,
 * the audio is fine, and the ring simply never appears — which reads as "the
 * indicator is broken" long before anybody suspects the threshold.
 */

/** A sine wave as an analyser's time-domain bytes, where 128 is silence. */
function tone(amplitude: number, samples = 512, cyclesPerBuffer = 8): Uint8Array {
  const bytes = new Uint8Array(samples)
  for (let index = 0; index < samples; index += 1) {
    const angle = (2 * Math.PI * cyclesPerBuffer * index) / samples
    bytes[index] = Math.round(128 + Math.sin(angle) * amplitude * 127)
  }
  return bytes
}

describe('how loud it is', () => {
  it('reads silence as nothing at all', () => {
    expect(rmsLevel(new Uint8Array(512).fill(128))).toBeCloseTo(0, 3)
  })

  it('reads a full-scale tone as about 0.7, which is what a sine wave is', () => {
    // The root mean square of a sine is its amplitude over root two. A measure
    // that returned 1 here would be measuring the peak, which clips and pumps.
    expect(rmsLevel(tone(1))).toBeCloseTo(0.707, 1)
  })

  it('grows with the volume rather than with the spectrum', () => {
    // The bug this replaced: averaging the frequency bins divides the sound by
    // however much of the spectrum is empty, and a voice lives in the bottom
    // tenth of it. The same tone measured two ways differed by an order of
    // magnitude, and the threshold was set against the wrong one.
    const quiet = rmsLevel(tone(0.02))
    const loud = rmsLevel(tone(0.5))

    expect(quiet).toBeLessThan(SPEAKING_LEVEL)
    expect(loud).toBeGreaterThan(SPEAKING_LEVEL)
    // And the pitch does not change the answer: the same volume an octave up
    // reads the same, because loudness is not frequency.
    expect(rmsLevel(tone(0.5, 512, 64))).toBeCloseTo(loud, 1)
  })

  it('is not fooled by an empty buffer', () => {
    expect(rmsLevel(new Uint8Array(0))).toBe(0)
  })
})

describe('who counts as talking', () => {
  const now = 1_000_000

  it('is talking while the sound is still recent', () => {
    expect(speakingNow({ muted: false, loudAt: now - 100, now })).toBe(true)
  })

  it('keeps holding across the gap between two words', () => {
    // Speech is not continuous, and an indicator following the waveform exactly
    // strobes all the way through a sentence.
    expect(speakingNow({ muted: false, loudAt: now - (SPEAKING_HOLD_MS - 1), now })).toBe(true)
  })

  it('lets go once the pause is longer than a pause', () => {
    expect(speakingNow({ muted: false, loudAt: now - SPEAKING_HOLD_MS, now })).toBe(false)
  })

  it('stops the moment the microphone is muted, hold or no hold', () => {
    // The one mistake this indicator must never make: a muted microphone is
    // silent, and a ring saying otherwise for a second afterwards is worse than
    // no ring at all.
    expect(speakingNow({ muted: true, loudAt: now, now })).toBe(false)
  })

  it('says nothing about somebody who has never made a sound', () => {
    expect(speakingNow({ muted: false, loudAt: 0, now })).toBe(false)
  })
})
