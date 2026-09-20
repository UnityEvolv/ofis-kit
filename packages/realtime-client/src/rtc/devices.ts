import { describeMediaError } from './mesh.js'

/**
 * Choosing a microphone, a camera and a speaker, and coping when the browser
 * says no.
 *
 * Almost all of the value here is in the failure cases. Picking a device is
 * easy; telling somebody the difference between "you denied permission" and
 * "Zoom still has your camera" is what stops a support ticket, and the browser
 * will not do it for you.
 */

export interface Devices {
  microphones: MediaDeviceInfo[]
  cameras: MediaDeviceInfo[]
  speakers: MediaDeviceInfo[]
}

export interface DeviceChoice {
  audioDeviceId?: string
  videoDeviceId?: string
  /** Output routing, so a call can go to headphones while alerts stay on speakers. */
  speakerDeviceId?: string
}

/**
 * Where a choice is remembered.
 *
 * Injected rather than reached for, because this package has to run on a phone
 * and `localStorage` does not exist there. The web app passes an adapter over
 * localStorage; React Native would pass one over its own storage.
 */
export interface DeviceStorage {
  read(): DeviceChoice
  write(choice: DeviceChoice): void
}

export function memoryDeviceStorage(initial: DeviceChoice = {}): DeviceStorage {
  let held = initial
  return {
    read: () => held,
    write: (choice) => {
      held = choice
    },
  }
}

/**
 * What is plugged in.
 *
 * Labels are empty until permission has been granted at least once, which is
 * why the pre-join panel asks for permission before showing the list: a picker
 * offering "Microphone 1" and "Microphone 2" is no use to anybody.
 */
export async function listDevices(): Promise<Devices> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return {
    microphones: all.filter((device) => device.kind === 'audioinput'),
    cameras: all.filter((device) => device.kind === 'videoinput'),
    speakers: all.filter((device) => device.kind === 'audiooutput'),
  }
}

export interface PermissionOutcome {
  granted: boolean
  /** Present when it failed: what happened, and what to do about it. */
  problem?: string
  /** True when permission was granted but the device was unusable. */
  inUseElsewhere?: boolean
}

/**
 * Ask for permission, and find out what actually happened.
 *
 * The awkward case this exists for: on some platforms a camera held by another
 * application grants permission and then hands back a stream with no data in it
 * at all. That looks identical to a working camera until somebody says they
 * cannot see you, so a black stream is checked for explicitly and reported as
 * the different problem it is.
 */
export async function requestPermission(
  want: { audio: boolean; video: boolean },
  deviceChoice: DeviceChoice = {},
): Promise<PermissionOutcome & { stream?: MediaStream }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: want.audio
        ? {
            ...(deviceChoice.audioDeviceId ? { deviceId: { exact: deviceChoice.audioDeviceId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
          }
        : false,
      video: want.video
        ? deviceChoice.videoDeviceId
          ? { deviceId: { exact: deviceChoice.videoDeviceId } }
          : true
        : false,
    })

    const dead = stream.getTracks().filter((track) => track.readyState === 'ended' || track.muted)
    if (dead.length > 0 && dead.length === stream.getTracks().length) {
      for (const track of stream.getTracks()) track.stop()
      return {
        granted: true,
        inUseElsewhere: true,
        problem:
          'Your camera or microphone is open in another app. Close it and try again — the permission is fine, the device is just busy.',
      }
    }

    return { granted: true, stream }
  } catch (cause) {
    return {
      granted: false,
      problem: describeMediaError(cause, want.video ? 'camera' : 'microphone'),
    }
  }
}

/**
 * Watch for devices arriving and leaving.
 *
 * Unplugging a headset mid-call should switch to the built-in microphone and
 * say so. A silent switch is worse than no switch: somebody carries on talking
 * into a headset that is no longer connected.
 */
export function watchDevices(onChange: (devices: Devices) => void): () => void {
  const handler = () => {
    void listDevices().then(onChange)
  }
  navigator.mediaDevices.addEventListener('devicechange', handler)
  return () => navigator.mediaDevices.removeEventListener('devicechange', handler)
}

/**
 * Whether a remembered choice is still available.
 *
 * A USB headset that is unplugged should fall back to the operating system's
 * default rather than failing with a constraint error nobody can interpret.
 */
export function stillAvailable(choice: DeviceChoice, devices: Devices): DeviceChoice {
  const has = (list: MediaDeviceInfo[], id?: string) =>
    id !== undefined && list.some((device) => device.deviceId === id)

  return {
    ...(has(devices.microphones, choice.audioDeviceId) ? { audioDeviceId: choice.audioDeviceId } : {}),
    ...(has(devices.cameras, choice.videoDeviceId) ? { videoDeviceId: choice.videoDeviceId } : {}),
    ...(has(devices.speakers, choice.speakerDeviceId)
      ? { speakerDeviceId: choice.speakerDeviceId }
      : {}),
  }
}

/** The name to show for a device that has lost its label. */
export function labelFor(device: MediaDeviceInfo, index: number): string {
  if (device.label) return device.label
  const kind =
    device.kind === 'audioinput' ? 'Microphone' : device.kind === 'videoinput' ? 'Camera' : 'Speaker'
  return `${kind} ${index + 1}`
}
