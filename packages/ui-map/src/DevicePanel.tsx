import { Alert, Button, Icon, Modal, Select } from '@unityevolv/unitykit'
import type { DeviceChoice, Devices } from '@unityevolv/ofiskit-realtime-client'
import {
  labelFor,
  listDevices,
  requestPermission,
  stillAvailable,
  watchDevices,
} from '@unityevolv/ofiskit-realtime-client'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Choosing a microphone, a camera and a speaker, and seeing that they work
 * before anybody else sees you.
 *
 * Most of the value here is in the failure cases. Picking a device from a list
 * is easy; the reason this screen exists is that "you denied permission" and
 * "another app is holding your camera" are different problems with different
 * fixes, and the browser reports them almost identically and explains neither.
 */

export interface DevicePanelProps {
  open: boolean
  onClose(): void
  choice: DeviceChoice
  onChoose(choice: DeviceChoice): void
  /** Applies the choice to a call that is already running. */
  onApply?(choice: DeviceChoice): void
  /** Shows the camera preview and the level meter before joining. */
  preview?: boolean
}

export function DevicePanel(props: DevicePanelProps) {
  const { open, choice, onChoose } = props

  const [devices, setDevices] = useState<Devices>({ microphones: [], cameras: [], speakers: [] })
  const [problem, setProblem] = useState<string | null>(null)
  const [inUseElsewhere, setInUseElsewhere] = useState(false)
  const [granted, setGranted] = useState(false)
  const [level, setLevel] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)

  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const audio = useRef<{ context: AudioContext; timer: ReturnType<typeof setInterval> } | null>(
    null,
  )

  const stop = useCallback(() => {
    for (const track of stream.current?.getTracks() ?? []) track.stop()
    stream.current = null
    if (audio.current) {
      clearInterval(audio.current.timer)
      void audio.current.context.close().catch(() => {})
      audio.current = null
    }
    setLevel(0)
  }, [])

  /**
   * Ask for permission, then list.
   *
   * In that order on purpose: device labels are empty until permission has been
   * granted once, and a picker offering "Microphone 1" and "Microphone 2" helps
   * nobody choose their headset.
   */
  const start = useCallback(async () => {
    const outcome = await requestPermission({ audio: true, video: props.preview ?? false }, choice)

    setGranted(outcome.granted)
    setProblem(outcome.problem ?? null)
    setInUseElsewhere(Boolean(outcome.inUseElsewhere))

    if (outcome.stream) {
      stream.current = outcome.stream
      if (video.current) video.current.srcObject = outcome.stream

      // A level meter, so nobody joins with a dead microphone and finds out
      // when somebody asks why they have been silent for two minutes.
      try {
        const context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 256
        context.createMediaStreamSource(outcome.stream).connect(analyser)
        const samples = new Uint8Array(analyser.frequencyBinCount)
        const timer = setInterval(() => {
          analyser.getByteFrequencyData(samples)
          let total = 0
          for (const sample of samples) total += sample
          setLevel(Math.min(1, total / samples.length / 128))
        }, 100)
        audio.current = { context, timer }
      } catch {
        // No meter is survivable; the picker still works.
      }
    }

    setDevices(await listDevices())
  }, [choice, props.preview])

  useEffect(() => {
    if (!open) return

    /*
     * Opening the panel asks the browser for the camera and microphone.
     *
     * This is an effect synchronising with an external system, which is what
     * effects are for: nothing is set until the browser answers, several
     * awaits later. The lint rule cannot see through an async call and reads
     * the setState calls inside `start` as synchronous ones, so it is disabled
     * here with the reason rather than the effect being contorted to please it.
     */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start()

    // Closing the panel runs this cleanup, which is what stops the camera and
    // the level meter. Doing it in the body as well would be a second stop.
    return stop
  }, [open, start, stop])

  /**
   * Follow the operating system when something is plugged in or pulled out.
   *
   * With a notice, never silently: somebody who unplugs a headset mid-sentence
   * needs to know their voice is now going through the laptop microphone, and
   * a silent switch is how people end up talking into a dead device.
   */
  useEffect(() => {
    if (!open) return
    return watchDevices((next) => {
      setDevices(next)
      const surviving = stillAvailable(choice, next)
      if (choice.audioDeviceId && !surviving.audioDeviceId) {
        setNotice('Your microphone was unplugged. The call switched to the built-in one.')
        onChoose(surviving)
        props.onApply?.(surviving)
      } else if (choice.videoDeviceId && !surviving.videoDeviceId) {
        setNotice('Your camera was unplugged.')
        onChoose(surviving)
        props.onApply?.(surviving)
      }
    })
  }, [open, choice, onChoose, props])

  const update = (patch: DeviceChoice) => {
    const next = { ...choice, ...patch }
    onChoose(next)
    props.onApply?.(next)
    // Stop the current preview before opening the newly chosen device, or two
    // cameras end up running and the meter reads the wrong microphone.
    stop()
    void start()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose()
      }}
      title="Microphone, camera and speaker"
    >
      <div className="space-y-4">
        {notice && (
          <Alert variant="info" onDismiss={() => setNotice(null)}>
            {notice}
          </Alert>
        )}

        {problem && (
          <Alert variant={inUseElsewhere ? 'warn' : 'danger'}>
            <p>{problem}</p>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => void start()}>
              Try again
            </Button>
          </Alert>
        )}

        {props.preview && (
          <div className="overflow-hidden rounded-lg bg-base-300">
            <video
              ref={video}
              autoPlay
              playsInline
              muted
              aria-label="Camera preview"
              className="aspect-video w-full scale-x-[-1] object-cover"
            />
          </div>
        )}

        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-medium text-base-content/70">
            <Icon name="mic" size="xs" />
            Microphone level
          </p>
          <div
            role="meter"
            aria-label="Microphone level"
            aria-valuenow={Math.round(level * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 w-full overflow-hidden rounded-full bg-base-300"
          >
            <div
              className="h-full rounded-full bg-success transition-[width] duration-100"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
          {granted && level === 0 && (
            <p className="mt-1 text-xs text-base-content/70">
              Say something — if this stays still, the microphone is not picking you up.
            </p>
          )}
        </div>

        <Select
          label="Microphone"
          value={choice.audioDeviceId ?? ''}
          onChange={(event) => update({ audioDeviceId: event.target.value || undefined })}
        >
          <option value="">System default</option>
          {devices.microphones.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {labelFor(device, index)}
            </option>
          ))}
        </Select>

        <Select
          label="Camera"
          value={choice.videoDeviceId ?? ''}
          onChange={(event) => update({ videoDeviceId: event.target.value || undefined })}
        >
          <option value="">System default</option>
          {devices.cameras.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {labelFor(device, index)}
            </option>
          ))}
        </Select>

        {/*
          Output routing, where the browser supports it, so a call can go to
          headphones while system sounds stay on the speakers.
        */}
        {devices.speakers.length > 0 && (
          <Select
            label="Speaker"
            value={choice.speakerDeviceId ?? ''}
            onChange={(event) => update({ speakerDeviceId: event.target.value || undefined })}
          >
            <option value="">System default</option>
            {devices.speakers.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {labelFor(device, index)}
              </option>
            ))}
          </Select>
        )}

        <p className="text-xs text-base-content/60">
          Noise suppression and echo cancellation are on. Your choice is remembered on this device.
        </p>
      </div>
    </Modal>
  )
}

/**
 * Said before the browser's own prompt, not after.
 *
 * The browser asks a blunt question with no context, and somebody who says no
 * to it has a much harder time saying yes later. Explaining first is the
 * difference between a prompt that gets accepted and a support ticket.
 */
export function PermissionPrimer({ onContinue }: { onContinue(): void }) {
  return (
    <div className="mx-auto max-w-sm rounded-lg bg-base-100 p-4 text-center ring-1 ring-base-300">
      <Icon name="mic" size="lg" />
      <h2 className="mt-2 text-lg font-semibold">Let your browser use the microphone</h2>
      <p className="mt-1 text-sm text-base-content/75">
        Your browser is about to ask. Nothing is recorded, and nothing is sent anywhere until you
        press the microphone button in a room.
      </p>
      <Button className="mt-3" onClick={onContinue}>
        Continue
      </Button>
    </div>
  )
}
