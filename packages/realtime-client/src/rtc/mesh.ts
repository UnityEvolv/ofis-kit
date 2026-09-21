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
import {
  desktopConstraints,
  describeShareError,
  shareCancelled,
  type ShareOptions,
} from './screen.js'

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
  senders: {
    audio: RTCRtpSender | null
    video: RTCRtpSender | null
    screen: RTCRtpSender | null
    /** A shared tab's own sound, when the browser gave us one. Usually null. */
    screenAudio: RTCRtpSender | null
  }
  wantsVideo: boolean
  /**
   * Every video stream this peer is sending, by stream id.
   *
   * Held rather than emitted straight through, because which one is the camera and
   * which is the screen is not knowable from the track: two video streams arrive
   * from the same peer and nothing in either says that one is a face and the other
   * is a spreadsheet. The answer comes over signalling, and may arrive before or
   * after the track it describes.
   */
  videoStreams: Map<string, MediaStream>
  /** Which of them the peer says is its screen. Null when it is not sharing. */
  shareStreamId: string | null
  /** What we last told the app, so a re-classification emits the difference only. */
  shown: { camera: string | null; screen: string | null }
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
   * Get hold of a screen, a window or a tab.
   *
   * Two paths, and the difference is who asked. With a source id the person has
   * already chosen from a picker their host drew — on a desktop app, where there is
   * no browser picker to open — so this captures it and asks nothing. Without one,
   * the browser's own picker is the right answer and the better one: it is the
   * picker people already know, and it is the only one that can offer a single tab.
   */
  async function captureScreen(sourceId?: string): Promise<MediaStream | null> {
    if (sourceId) {
      try {
        return await navigator.mediaDevices.getUserMedia(desktopConstraints(sourceId))
      } catch (cause) {
        // No picker was involved, so there is nothing the person could have
        // cancelled: whatever went wrong here is worth saying.
        emit({ type: 'failed', reason: describeShareError(cause) })
        return null
      }
    }

    const video = { frameRate: { ideal: SCREEN_CEILING.maxFramerate } }

    try {
      /*
       * Audio is asked for and never taken.
       *
       * Where the browser supports it, asking is what puts an unticked "also share
       * tab audio" box in its picker — so the person decides, and the default is
       * off. Not asking would mean a share of a video call or a demo with the sound
       * missing and no way to add it.
       */
      return await navigator.mediaDevices.getDisplayMedia({ video, audio: true })
    } catch (cause) {
      if (shareCancelled(cause)) return null

      // Some browsers refuse the whole request rather than ignoring the audio they
      // cannot provide. The screen is the point; the sound is not worth losing it.
      try {
        return await navigator.mediaDevices.getDisplayMedia({ video, audio: false })
      } catch (retry) {
        if (!shareCancelled(retry)) emit({ type: 'failed', reason: describeShareError(retry) })
        return null
      }
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
      senders: { audio: null, video: null, screen: null, screenAudio: null },
      wantsVideo: true,
      videoStreams: new Map(),
      shareStreamId: null,
      shown: { camera: null, screen: null },
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

      /*
       * A shared tab's sound travels inside the share's own stream, so it is not
       * the voice: it goes out of the share, where what is making the noise is on
       * screen, rather than out of the element playing this person's microphone —
       * which it would otherwise replace, leaving somebody inaudible for as long
       * as they share a tab.
       */
      if (track.kind === 'audio') {
        if (stream.id === peer.shareStreamId) return
        emit({ type: 'track', deviceId: peer.deviceId, stream, source: 'audio' })
        track.onended = () => emit({ type: 'track.ended', deviceId: peer.deviceId, source: 'audio' })
        return
      }

      peer.videoStreams.set(stream.id, stream)
      track.onended = () => {
        peer.videoStreams.delete(stream.id)
        syncVideo(peer)
      }
      syncVideo(peer)
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

  /**
   * Work out which of a peer's video streams is the camera and which is the screen,
   * and tell the app only about what changed.
   *
   * The two inputs — the streams that have arrived and the stream id the peer says
   * is its screen — arrive independently, and either can come first. So this is
   * recomputed on both and is deliberately idempotent: calling it twice with the
   * same inputs emits nothing, and a share announced a moment after its track
   * arrived corrects itself by moving that stream from one slot to the other.
   *
   * A second video stream nobody announced is left alone rather than guessed at. A
   * spreadsheet drawn in a face tile looks like a bug in the tiles, and a peer that
   * never announces is a peer running something other than this adapter.
   */
  function syncVideo(peer: Peer): void {
    const screen =
      peer.shareStreamId && peer.videoStreams.has(peer.shareStreamId) ? peer.shareStreamId : null
    const camera = [...peer.videoStreams.keys()].find((id) => id !== screen) ?? null

    for (const [source, id] of [
      ['camera', camera],
      ['screen', screen],
    ] as const) {
      if (peer.shown[source] === id) continue
      peer.shown[source] = id

      const stream = id === null ? undefined : peer.videoStreams.get(id)
      if (stream) emit({ type: 'track', deviceId: peer.deviceId, stream, source })
      else emit({ type: 'track.ended', deviceId: peer.deviceId, source })
    }
  }

  /**
   * Tell a peer which stream is our screen.
   *
   * Over signalling rather than over the call's own events, because it is nobody
   * else's business: it is a stream id, it means nothing outside this pair of
   * connections, and a provider whose SDK labels its own tracks never sends it. The
   * core relays it without looking inside, exactly as it does an offer.
   *
   * Sent before the track is added, which is what keeps the receiver from having to
   * guess: signalling is one hop over an open socket and media needs a
   * renegotiation, so the description arrives first in any ordinary case — and the
   * receiver corrects itself in the case where it does not.
   */
  function announceShare(peer: Peer): void {
    signaller.send({
      to: peer.deviceId,
      type: 'share',
      payload: { streamId: screen?.id ?? null, active: screen !== null },
    })
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

    const sharing = screen
    const screenTrack = sharing?.getVideoTracks()[0]
    if (sharing && screenTrack && !peer.senders.screen) {
      // Which stream is the screen, said before the stream itself turns up.
      announceShare(peer)
      peer.senders.screen = peer.connection.addTrack(screenTrack, sharing)
      await applyScreenCeiling(peer.senders.screen)

      /*
       * A shared tab's own sound, if the person ticked the browser's box.
       *
       * Sent inside the share's stream rather than beside it, so it arrives as part
       * of the thing making the noise: what is playing comes out of the share, and
       * this person's voice keeps coming out of their own element.
       */
      const soundTrack = sharing.getAudioTracks()[0]
      if (soundTrack && !peer.senders.screenAudio) {
        peer.senders.screenAudio = peer.connection.addTrack(soundTrack, sharing)
        await applyAudioCeiling(peer.senders.screenAudio)
      }
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
      /*
       * Which of this peer's streams is its screen.
       *
       * Not media and not negotiation: it is the one thing about a share the
       * receiver cannot see for itself, and it arrives on the same channel because
       * that is the channel the pair of them already have.
       */
      if (message.type === 'share') {
        const payload = message.payload as { streamId?: unknown; active?: unknown } | null
        const streamId = typeof payload?.streamId === 'string' ? payload.streamId : null
        peer.shareStreamId = payload?.active === true ? streamId : null
        syncVideo(peer)
        return
      }

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

      // Said as well as done. Leaving stops the capture, and a stream the UI still
      // believes in is a share still drawn over an office nobody is in a call in.
      emit({ type: 'local', stream: null, source: 'camera' })
      emit({ type: 'local', stream: null, source: 'screen' })

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

    async startScreenShare(options?: ShareOptions) {
      const captured = await captureScreen(options?.sourceId)
      // Either the person closed the picker, which is not a failure and says
      // nothing, or the capture failed and has already said so.
      if (!captured) return false
      screen = captured

      /*
       * Stopping from outside this app has to clean up inside it.
       *
       * The browser's own sharing bar and closing the shared window are how people
       * actually stop, and forgetting to stop at all is the commonest failure in any
       * call product — so the track ending is treated as the person having stopped,
       * which it is.
       */
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

      // Stopped before anything is unpublished: the capture is what the operating
      // system is recording, and it is the thing that must stop first.
      for (const capture of screen.getTracks()) capture.stop()
      screen = null

      for (const peer of peers.values()) {
        for (const kind of ['screen', 'screenAudio'] as const) {
          const sender = peer.senders[kind]
          if (!sender) continue
          peer.connection.removeTrack(sender)
          peer.senders[kind] = null
        }
        // And told, so a peer holding the last frame knows it is not a share any
        // more rather than keeping a still of a spreadsheet on screen.
        announceShare(peer)
      }

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
