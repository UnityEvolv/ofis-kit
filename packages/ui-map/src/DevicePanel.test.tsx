import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DevicePanel, PermissionPrimer } from './DevicePanel.js'

/**
 * The picker, and mostly its failures.
 *
 * Choosing from a list is easy. The reason this panel exists is that "you denied
 * permission" and "another app is holding your camera" are different problems with
 * different fixes, and the browser reports them almost identically and explains
 * neither.
 */

function track(kind: 'audio' | 'video', state: Partial<MediaStreamTrack> = {}): MediaStreamTrack {
  return { kind, readyState: 'live', muted: false, stop: vi.fn(), ...state } as MediaStreamTrack
}

function stream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((one) => one.kind === 'audio'),
    getVideoTracks: () => tracks.filter((one) => one.kind === 'video'),
  } as MediaStream
}

function info(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: 'g', toJSON: () => ({}) } as MediaDeviceInfo
}

/** jsdom has neither mediaDevices nor an AudioContext. */
function browser(options: {
  devices?: MediaDeviceInfo[]
  getUserMedia?: () => Promise<MediaStream>
}) {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => options.devices ?? [],
      getUserMedia: options.getUserMedia ?? (async () => stream([track('audio')])),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  })
}

beforeEach(() => {
  // The level meter is decoration: without it the picker still works, which the
  // component's own try/catch says. Absent here so the tests are about the
  // picking rather than about Web Audio.
  Reflect.deleteProperty(globalThis as Record<string, unknown>, 'AudioContext')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const panel = (props: Partial<React.ComponentProps<typeof DevicePanel>> = {}) =>
  render(
    <DevicePanel
      open
      onClose={() => {}}
      choice={{}}
      onChoose={() => {}}
      {...props}
    />,
  )

describe('the device panel', () => {
  it('lists what is plugged in, by name', async () => {
    browser({
      devices: [
        info('audioinput', 'headset', 'Jabra Evolve'),
        info('videoinput', 'cam', 'FaceTime HD'),
        info('audiooutput', 'out', 'External Speakers'),
      ],
    })

    panel()

    // Permission first, then the list: labels are empty until permission has been
    // granted once, and a picker offering "Microphone 1" helps nobody find their
    // headset.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Jabra Evolve' })).toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: /microphone/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /camera/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /speaker/i })).toBeInTheDocument()
  })

  it('offers no speaker choice where the browser lists no outputs', async () => {
    browser({ devices: [info('audioinput', 'mic', 'Built-in')] })
    panel()

    await waitFor(() => expect(screen.getByRole('option', { name: 'Built-in' })).toBeInTheDocument())
    expect(screen.queryByRole('combobox', { name: /speaker/i })).not.toBeInTheDocument()
  })

  it('says exactly how to fix a denied permission, and offers to try again', async () => {
    const denied = new Error('denied')
    denied.name = 'NotAllowedError'
    browser({ getUserMedia: async () => Promise.reject(denied) })

    panel()

    // The browser's own message is no help at all, and denied permission is the
    // most common support question in any call product.
    await waitFor(() => expect(screen.getByText(/padlock in the address bar/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('tells somebody their camera is busy, not that something went wrong', async () => {
    // Permission granted, stream dead: a different problem with a different fix,
    // and on some platforms it arrives as a silent black stream rather than an
    // error at all.
    browser({ getUserMedia: async () => stream([track('video', { readyState: 'ended' })]) })

    panel({ preview: true })

    await waitFor(() => expect(screen.getByText(/open in another app/i)).toBeInTheDocument())
    expect(screen.getByText(/the permission is fine, the device is just busy/i)).toBeInTheDocument()
  })

  it('shows the camera and a level meter before anybody else sees you', async () => {
    browser({ devices: [info('videoinput', 'cam', 'FaceTime HD')] })
    panel({ preview: true })

    expect(screen.getByLabelText('Camera preview')).toBeInTheDocument()
    // A meter, so nobody joins with a dead microphone and finds out when somebody
    // asks why they have been silent for two minutes.
    expect(screen.getByRole('meter', { name: /microphone level/i })).toBeInTheDocument()
  })

  it('remembers a new choice and applies it to a call already running', async () => {
    const person = userEvent.setup()
    const onChoose = vi.fn()
    const onApply = vi.fn()
    browser({
      devices: [info('audioinput', 'headset', 'Jabra'), info('audioinput', 'built-in', 'Built-in')],
    })

    panel({ onChoose, onApply })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Jabra' })).toBeInTheDocument())

    await person.selectOptions(screen.getByRole('combobox', { name: /microphone/i }), 'headset')

    expect(onChoose).toHaveBeenCalledWith({ audioDeviceId: 'headset' })
    // Applied in place, because swapping a headset mid-call should not interrupt
    // the conversation.
    expect(onApply).toHaveBeenCalledWith({ audioDeviceId: 'headset' })
  })

  it('says the browser’s own cleanup is on, and that the choice is kept', async () => {
    browser({})
    panel()
    await waitFor(() =>
      expect(screen.getByText(/noise suppression and echo cancellation are on/i)).toBeInTheDocument(),
    )
    expect(screen.getByText(/remembered on this device/i)).toBeInTheDocument()
  })
})

describe('before the browser asks', () => {
  it('explains what is about to happen, and that nothing is recorded', async () => {
    // The browser asks a blunt question with no context, and somebody who says no
    // to it has a much harder time saying yes later.
    const person = userEvent.setup()
    const onContinue = vi.fn()
    render(<PermissionPrimer onContinue={onContinue} />)

    expect(screen.getByRole('heading', { name: /let your browser use the microphone/i })).toBeInTheDocument()
    expect(screen.getByText(/nothing is recorded/i)).toBeInTheDocument()

    await person.click(screen.getByRole('button', { name: /continue/i }))
    expect(onContinue).toHaveBeenCalled()
  })
})
