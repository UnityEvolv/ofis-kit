import type { IceServer, SignalMessage } from '@unityevolv/ofiskit-realtime-core/protocol'

import {
  AUDIO_BITRATE,
  CONNECT_TIMEOUT_MS,
  LEVEL_INTERVAL_MS,
  SCREEN_CEILING,
  SPEAKING_LEVEL,
  VIDEO_STEPS,
  rmsLevel,
  speakingNow,
  type JoinOptions,
  type RtcClientAdapter,
  type RtcEvent,
  type RtcHandler,
  type Signaller,
} from './adapter.js'

/**
 * The built-in provider's client half: peer-to-peer WebRTC in a full mesh.
 *
 * Every participant connects to every other one, up to four, and the server
 * never sees a byte of media — it only relays offers, answers and candidates.
 * That is what makes this cheap enough to be the free tier and simple enough to
 * be the open-source one.
 *
 * The cost of a mesh is that the sender does all the work: with no SFU there is
 * no simulcast, so one camera is uploaded separately to every peer. Four people
 * plus a screen share is the heaviest thing here, and it is the reason the cap
 * is four rather than a number somebody picked.
 */

interface Peer {
  deviceId: string
  userId: string
  displayName: string
  connection: RTCPeerConnection
  /**
   * Who backs down when both sides offer at once.
   *
   * Decided by comparing device ids, so both sides always reach the same answer
   * without another round trip. The polite peer rolls back its own offer; the
   * impolite one ignores the incoming one.
   */
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  senders: { audio: RTCRtpSender | null; video: RTCRtpSender | null; screen: RTCRtpSender | null }
  wantsVideo: boolean
  connectTimer: ReturnType<typeof setTimeout> | null
}

export function meshAdapter(signaller: Signaller): RtcClientAdapter {
  const handlers = new Set<RtcHandler>()
  const peers = new Map<string, Peer>()

  let selfDeviceId = ''
  let iceServers: IceServer[] = []
  let stopSignals: (() => void) | null = null

  let microphone: MediaStream | null = null
  let camera: MediaStream | null = null
  let screen: MediaStream | null = null
  let audioDeviceId: string | undefined
  let videoDeviceId: string | undefined

  let videoStep = 0
  let statsTimer: ReturnType<typeof setInterval> | null = null
  let levelTimer: ReturnType<typeof setInterval> | null = null
  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let speaking = false
  /** When the level was last above the threshold, which is what the hold measures from. */
  let loudAt = 0

  const emit = (event: RtcEvent) => {
    for (const handler of [...handlers]) handler(event)
  }

  const state = () =>
    emit({
      type: 'state',
      muted: microphone === null || !(microphone.getAudioTracks()[0]?.enabled ?? false),
      cameraOn: camera !== null,
      sharing: screen !== null,
    })

  // ------------------------------------------------------------ local media

  async function ensureMicrophone(): Promise<MediaStream | null> {
    if (microphone) return microphone
    try {
      microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
          // What the browser gives us for free, and what makes a laptop in a
          // room with three other people usable at all.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      watchLevel(microphone)
      return microphone
    } catch (cause) {
      emit({ type: 'failed', reason: describeMediaError(cause, 'microphone') })
      return null
    }
  }

  async function ensureCamera(): Promise<MediaStream | null> {
    if (camera) return camera
    try {
      const step = VIDEO_STEPS[videoStep] ?? VIDEO_STEPS[0]
      camera = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}),
          height: { ideal: step.height },
          frameRate: { ideal: step.maxFramerate },
        },
      })
      emit({ type: 'local', stream: camera, source: 'camera' })
      return camera
    } catch (cause) {
      emit({ type: 'failed', reason: describeMediaError(cause, 'camera') })
      return null
    }
  }

  /**
   * Own microphone level, measured locally.
   *
   * Client-side because in a mesh there is no server in the media path to
   * measure it. Reported only when it crosses the threshold, not on a tick, so
   * the socket carries a handful of events per person rather than a stream.
   *
   * The measure is the root mean square of the waveform, which is how loud the
   * sound is. Muting stops it immediately rather than waiting out the hold: a
   * muted microphone is silent, and an indicator saying otherwise for a second
   * afterwards is the one mistake this indicator must never make.
   */
  function watchLevel(stream: MediaStream): void {
    try {
      audioContext = new AudioContext()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      audioContext.createMediaStreamSource(stream).connect(analyser)

      const samples = new Uint8Array(analyser.fftSize)
      levelTimer = setInterval(() => {
        if (!analyser) return
        analyser.getByteTimeDomainData(samples)
        const level = rmsLevel(samples)

        const muted = !(microphone?.getAudioTracks()[0]?.enabled ?? false)
        if (!muted && level > SPEAKING_LEVEL) loudAt = Date.now()

        // Held briefly after the level drops, because the gap between two words
        // is not the end of somebody talking.
        const now = speakingNow({ muted, loudAt, now: Date.now() })
        if (now !== speaking) {
          speaking = now
          emit({ type: 'speaking', speaking: now, level })
        }
      }, LEVEL_INTERVAL_MS)
    } catch {
      // No audio context is survivable: speaking indicators stop working and
      // the call itself is unaffected, which is the right thing to lose.
    }
  }

  // ------------------------------------------------------------------ peers

  function createPeer(participant: { deviceId: string; userId: string; displayName: string }): Peer {
    const connection = new RTCPeerConnection({
      iceServers: iceServers.map((server) => ({
        urls: server.urls,
        ...(server.username ? { username: server.username } : {}),
        ...(server.credential ? { credential: server.credential } : {}),
      })),
      // Relay is never forced. A direct connection costs nobody anything and is
      // the better path; TURN is what happens when there is no other option.
      iceTransportPolicy: 'all',
    })

    const peer: Peer = {
      ...participant,
      connection,
      polite: selfDeviceId < participant.deviceId,
      makingOffer: false,
      ignoreOffer: false,
      senders: { audio: null, video: null, screen: null },
      wantsVideo: true,
      connectTimer: null,
    }

    connection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        signaller.send({ to: peer.deviceId, type: 'candidate', payload: candidate.toJSON() })
      }
    }

    connection.onnegotiationneeded = () => {
      void (async () => {
        try {
          peer.makingOffer = true
          await connection.setLocalDescription()
          signaller.send({
            to: peer.deviceId,
            type: 'offer',
            payload: connection.localDescription?.toJSON(),
          })
        } catch {
          // A failed renegotiation must not take the call down. Audio keeps
          // flowing on the existing description and the next change tries again.
        } finally {
          peer.makingOffer = false
        }
      })()
    }

    connection.ontrack = ({ track, streams }) => {
      const stream = streams[0]
      if (!stream) return
      const source: 'camera' | 'screen' | 'audio' =
        track.kind === 'audio' ? 'audio' : stream.id === screenStreamIdOf(peer) ? 'screen' : 'camera'
      emit({ type: 'track', deviceId: peer.deviceId, stream, source })
      track.onended = () => emit({ type: 'track.ended', deviceId: peer.deviceId, source })
    }

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connected') {
        if (peer.connectTimer) clearTimeout(peer.connectTimer)
        peer.connectTimer = null
      }
      if (connection.connectionState === 'failed') {
        // An ICE restart handles the ordinary case: switching from wifi to
        // wired, or a phone changing network, should not end a call.
        void restart(peer)
      }
    }

    // Bounded, so a network that blocks everything produces a clear message
    // rather than a spinner that never resolves.
    peer.connectTimer = setTimeout(() => {
      if (connection.connectionState !== 'connected') {
        emit({
          type: 'failed',
          deviceId: peer.deviceId,
          reason: `Could not connect to ${peer.displayName} on this network.`,
        })
      }
    }, CONNECT_TIMEOUT_MS)

    peers.set(peer.deviceId, peer)
    emit({
      type: 'participant.joined',
      deviceId: peer.deviceId,
      userId: peer.userId,
      displayName: peer.displayName,
    })
    return peer
  }

  function screenStreamIdOf(peer: Peer): string | undefined {
    // The share is the second video stream from a peer; the transceiver's mid
    // is the reliable discriminator, and this is the pragmatic version of it.
    return peer.connection
      .getTransceivers()
      .find((transceiver) => transceiver.mid === '2')
      ?.receiver.track.id
  }

  async function restart(peer: Peer): Promise<void> {
    try {
      await peer.connection.setLocalDescription(await peer.connection.createOffer({ iceRestart: true }))
      signaller.send({
        to: peer.deviceId,
        type: 'offer',
        payload: peer.connection.localDescription?.toJSON(),
      })
    } catch {
      emit({
        type: 'failed',
        deviceId: peer.deviceId,
        reason: `Lost the connection to ${peer.displayName}.`,
      })
    }
  }

  async function publishTo(peer: Peer): Promise<void> {
    const audioTrack = microphone?.getAudioTracks()[0]
    if (audioTrack && !peer.senders.audio) {
      peer.senders.audio = peer.connection.addTrack(audioTrack, microphone!)
      await applyAudioCeiling(peer.senders.audio)
    }

    const videoTrack = camera?.getVideoTracks()[0]
    if (videoTrack && !peer.senders.video) {
      peer.senders.video = peer.connection.addTrack(videoTrack, camera!)
      await applyVideoCeiling(peer.senders.video, peer.wantsVideo)
    }

    const screenTrack = screen?.getVideoTracks()[0]
    if (screenTrack && !peer.senders.screen) {
      peer.senders.screen = peer.connection.addTrack(screenTrack, screen!)
      await applyScreenCeiling(peer.senders.screen)
    }
  }

  async function applyAudioCeiling(sender: RTCRtpSender): Promise<void> {
    const parameters = sender.getParameters()
    parameters.encodings = [{ maxBitrate: AUDIO_BITRATE, priority: 'high' }]
    await sender.setParameters(parameters).catch(() => {})
  }

  async function applyVideoCeiling(sender: RTCRtpSender, wanted: boolean): Promise<void> {
    const step = VIDEO_STEPS[videoStep] ?? VIDEO_STEPS[VIDEO_STEPS.length - 1]!
    const parameters = sender.getParameters()
    parameters.degradationPreference = 'maintain-framerate'
    parameters.encodings = [
      wanted
        ? { maxBitrate: step.maxBitrate, maxFramerate: step.maxFramerate, active: true }
        : // Not one of the visible tiles: stop sending video to this peer
          // entirely rather than sending something nobody is looking at.
          { active: false },
    ]
    await sender.setParameters(parameters).catch(() => {})
  }

  async function applyScreenCeiling(sender: RTCRtpSender): Promise<void> {
    const parameters = sender.getParameters()
    // Resolution over frame rate: a share that is sharp and slightly jerky is
    // far more useful than a smooth one nobody can read.
    parameters.degradationPreference = 'maintain-resolution'
    parameters.encodings = [
      { maxBitrate: SCREEN_CEILING.maxBitrate, maxFramerate: SCREEN_CEILING.maxFramerate },
    ]
    await sender.setParameters(parameters).catch(() => {})
  }

  /**
   * Watch the connection and step video down before audio suffers.
   *
   * Video degrades first, always. If audio itself starts failing the client
   * drops its own outgoing video and says so, rather than letting both collapse
   * and leaving the person wondering what happened.
   */
  function watchStats(): void {
    statsTimer = setInterval(() => {
      void (async () => {
        let worstLoss = 0
        let worstRtt = 0

        for (const peer of peers.values()) {
          const stats = await peer.connection.getStats().catch(() => null)
          if (!stats) continue

          let relayed = false
          let packetLoss = 0
          let roundTripMs = 0

          stats.forEach((report) => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              roundTripMs = Math.round((report.currentRoundTripTime ?? 0) * 1000)
            }
            if (report.type === 'local-candidate' && report.candidateType === 'relay') {
              relayed = true
            }
            if (report.type === 'remote-inbound-rtp') {
              packetLoss = Math.max(packetLoss, report.fractionLost ?? 0)
            }
          })

          worstLoss = Math.max(worstLoss, packetLoss)
          worstRtt = Math.max(worstRtt, roundTripMs)
          emit({ type: 'quality', deviceId: peer.deviceId, relayed, packetLoss, roundTripMs })
        }

        await adaptTo(worstLoss, worstRtt)
      })()
    }, 3000)
  }

  async function adaptTo(loss: number, roundTripMs: number): Promise<void> {
    const before = videoStep

    if ((loss > 0.08 || roundTripMs > 400) && videoStep < VIDEO_STEPS.length - 1) {
      videoStep += 1
    } else if (loss < 0.02 && roundTripMs < 200 && videoStep > 0) {
      // Step back up as it recovers, so a brief wobble does not leave somebody
      // at 180p for the rest of the call.
      videoStep -= 1
    }

    if (videoStep !== before) {
      for (const peer of peers.values()) {
        if (peer.senders.video) await applyVideoCeiling(peer.senders.video, peer.wantsVideo)
      }
      emit({
        type: 'degraded',
        videoDropped: false,
        reason:
          videoStep > before
            ? 'Your video was reduced to keep the audio clear.'
            : 'Your video quality has recovered.',
      })
    }

    // Audio itself is in trouble. Drop our own video rather than letting both
    // collapse, and say so.
    if (loss > 0.2 && camera) {
      await setCamera(false)
      emit({
        type: 'degraded',
        videoDropped: true,
        reason: 'Your connection could not carry video, so it was turned off to protect the audio.',
      })
    }
  }

  // -------------------------------------------------------------- signalling

  async function onSignal(message: SignalMessage & { from: string }): Promise<void> {
    let peer = peers.get(message.from)

    /*
     * Somebody we have not met is offering.
     *
     * This is the other half of the join sequence. A new participant connects
     * out to everyone already in the call; from the point of view of those
     * already here, the first they hear of the new arrival is this offer, and
     * without creating a peer for it the offer is dropped and the two sides
     * never connect. The new person joins a call in which nobody can hear them.
     *
     * The display name is left empty deliberately: the UI takes names from the
     * office state, which already knows everybody, so the adapter does not need
     * to be told twice.
     */
    if (!peer && message.type === 'offer') {
      peer = createPeer({ deviceId: message.from, userId: '', displayName: '' })
    }
    if (!peer) return

    try {
      if (message.type === 'candidate') {
        await peer.connection.addIceCandidate(message.payload as RTCIceCandidateInit)
        return
      }

      const description = message.payload as RTCSessionDescriptionInit

      // Perfect negotiation: both sides can offer at once without deadlocking,
      // which matters here because turning a camera on renegotiates and two
      // people do that at the same moment more often than you would think.
      const offerCollision =
        description.type === 'offer' &&
        (peer.makingOffer || peer.connection.signalingState !== 'stable')

      peer.ignoreOffer = !peer.polite && offerCollision
      if (peer.ignoreOffer) return

      await peer.connection.setRemoteDescription(description)
      if (description.type === 'offer') {
        await peer.connection.setLocalDescription()
        signaller.send({
          to: peer.deviceId,
          type: 'answer',
          payload: peer.connection.localDescription?.toJSON(),
        })

        // Send our own microphone and camera to them, once the answer is out.
        // Doing it after rather than before means one clean renegotiation
        // instead of an offer colliding with the one we are already answering.
        await publishTo(peer)
      }
    } catch {
      // A malformed or out-of-order message is not worth ending a call over.
    }
  }

  // --------------------------------------------------------------- the API

  async function setCamera(on: boolean): Promise<void> {
    if (on) {
      const stream = await ensureCamera()
      if (!stream) return
      for (const peer of peers.values()) await publishTo(peer)
    } else if (camera) {
      for (const peer of peers.values()) {
        if (peer.senders.video) {
          peer.connection.removeTrack(peer.senders.video)
          peer.senders.video = null
        }
      }
      for (const track of camera.getTracks()) track.stop()
      camera = null
      emit({ type: 'local', stream: null, source: 'camera' })
    }
    state()
  }

  return {
    async join(options: JoinOptions) {
      selfDeviceId = options.deviceId
      iceServers = options.iceServers
      audioDeviceId = options.audioDeviceId
      videoDeviceId = options.videoDeviceId
      videoStep = 0

      stopSignals = signaller.receive((message) => {
        void onSignal(message)
      })

      if (options.audio) await ensureMicrophone()
      if (options.video) await ensureCamera()

      // The new arrival connects out to everyone already here. Existing
      // participants learn about them from the offer that follows.
      for (const participant of options.participants) {
        const peer = createPeer(participant)
        await publishTo(peer)
      }

      watchStats()
      state()
    },

    async leave() {
      for (const peer of peers.values()) {
        if (peer.connectTimer) clearTimeout(peer.connectTimer)
        peer.connection.close()
        emit({ type: 'participant.left', deviceId: peer.deviceId })
      }
      peers.clear()

      for (const stream of [microphone, camera, screen]) {
        for (const track of stream?.getTracks() ?? []) track.stop()
      }
      microphone = null
      camera = null
      screen = null

      if (statsTimer) clearInterval(statsTimer)
      if (levelTimer) clearInterval(levelTimer)
      statsTimer = null
      levelTimer = null
      analyser = null
      await audioContext?.close().catch(() => {})
      audioContext = null

      stopSignals?.()
      stopSignals = null
      speaking = false
      loudAt = 0
    },

    async setMicrophone(on: boolean) {
      const stream = on ? await ensureMicrophone() : microphone
      const track = stream?.getAudioTracks()[0]
      if (track) track.enabled = on
      if (on && stream) {
        for (const peer of peers.values()) await publishTo(peer)
      }
      state()
    },

    setCamera,

    async startScreenShare() {
      try {
        screen = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: SCREEN_CEILING.maxFramerate } },
          // Tab audio where the browser supports it, off unless asked for.
          audio: false,
        })
      } catch {
        // The person closed the picker. Not an error, and nothing to report.
        return false
      }

      // Stopping from the browser's own sharing bar, or by closing the window,
      // has to clean up here too — forgetting to stop is the common failure and
      // the browser's control is the one people actually reach for.
      const track = screen.getVideoTracks()[0]
      if (track) {
        track.onended = () => {
          void this.stopScreenShare()
        }
      }

      for (const peer of peers.values()) await publishTo(peer)
      emit({ type: 'local', stream: screen, source: 'screen' })
      state()
      return true
    },

    async stopScreenShare() {
      if (!screen) return
      for (const peer of peers.values()) {
        if (peer.senders.screen) {
          peer.connection.removeTrack(peer.senders.screen)
          peer.senders.screen = null
        }
      }
      for (const track of screen.getTracks()) track.stop()
      screen = null
      emit({ type: 'local', stream: null, source: 'screen' })
      state()
    },

    setVideoSubscriptions(deviceIds: string[]) {
      const wanted = new Set(deviceIds)
      for (const peer of peers.values()) {
        const next = wanted.has(peer.deviceId)
        if (next === peer.wantsVideo) continue
        peer.wantsVideo = next
        if (peer.senders.video) void applyVideoCeiling(peer.senders.video, next)
      }
    },

    async useDevices(devices) {
      audioDeviceId = devices.audioDeviceId ?? audioDeviceId
      videoDeviceId = devices.videoDeviceId ?? videoDeviceId

      // Replace the track in place rather than renegotiating: swapping a headset
      // mid-call should not interrupt the conversation.
      if (devices.audioDeviceId && microphone) {
        const replacement = await navigator.mediaDevices
          .getUserMedia({ audio: { deviceId: { exact: devices.audioDeviceId } } })
          .catch(() => null)
        const track = replacement?.getAudioTracks()[0]
        if (track) {
          for (const peer of peers.values()) await peer.senders.audio?.replaceTrack(track)
          for (const old of microphone.getAudioTracks()) old.stop()
          microphone = replacement
        }
      }

      if (devices.videoDeviceId && camera) {
        const replacement = await navigator.mediaDevices
          .getUserMedia({ video: { deviceId: { exact: devices.videoDeviceId } } })
          .catch(() => null)
        const track = replacement?.getVideoTracks()[0]
        if (track) {
          for (const peer of peers.values()) await peer.senders.video?.replaceTrack(track)
          for (const old of camera.getVideoTracks()) old.stop()
          camera = replacement
          emit({ type: 'local', stream: camera, source: 'camera' })
        }
      }
    },

    on(handler: RtcHandler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}

/**
 * Turn a getUserMedia failure into something worth reading.
 *
 * Denied permission is the most common support question in any call product,
 * and the browser's own message is no help at all. A device held by another app
 * is a different problem with a different fix, and on some platforms it arrives
 * as a silent black stream rather than an error, so the two must not be
 * collapsed into "something went wrong".
 */
export function describeMediaError(cause: unknown, device: 'microphone' | 'camera'): string {
  const name = cause instanceof Error ? cause.name : ''

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Your browser is blocking the ${device}. Open the padlock in the address bar, allow the ${device}, and try again.`
    case 'NotReadableError':
    case 'TrackStartError':
      return `Another app is using your ${device}. Close it and try again — video calls and recording apps hold on to it.`
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No ${device} was found. Check that it is plugged in.`
    case 'OverconstrainedError':
      return `That ${device} is no longer available. Pick a different one in settings.`
    default:
      return `The ${device} could not be started.`
  }
}
