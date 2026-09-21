import type { OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { callIn, sharerIn, you as yourPresence, yourRoom } from '@unityevolv/ofiskit-realtime-client'
import { useAnnounce, usePersisted } from '@unityevolv/ofiskit-ui-map'
import type { OfficeState } from '@unityevolv/ofiskit-realtime-client'
import type {
  Reaction,
  RoomCall,
  ScreenSource,
  ScreenSourceProvider,
} from '@unityevolv/ofiskit-realtime-client'
import { useCallback, useState } from 'react'

/**
 * What the controls bar does when it is pressed.
 *
 * The rule the whole story turns on: **entering a room never joins its call, and
 * pressing the microphone or the camera is what joins.** Which means every one of
 * these controls is two different actions depending on whether you are already in,
 * and putting that in one place is the difference between it being a rule and
 * being three slightly different rules.
 *
 * It lives in the app rather than in the map package because it is a conversation
 * between the client and the provider's adapter, and the map package's job is to
 * draw. A wrapper can lay the bar out differently; what it should not do is decide
 * differently about this.
 */

/**
 * What has to be asked before a share can start, if anything.
 *
 * Two questions and no more. Taking over is asked because ending somebody else's
 * share without warning looks like a crash to them; the source list is asked only on
 * a platform whose browser has no picker of its own, and on the web neither appears
 * and the browser's picker opens immediately.
 */
export type ShareQuestion =
  | { kind: 'take-over'; sharerName: string }
  | { kind: 'sources'; list: ScreenSource[] }

export interface CallControls {
  /** False in reception and the break room, which never have calls. */
  available: boolean
  inCall: boolean
  muted: boolean
  cameraOn: boolean
  sharing: boolean
  /** Whoever else is sharing, by name, so the control can say what it would do. */
  sharedByOther: string | null
  call: RoomCall | null
  /** Your own hand, read from the office state like every other call signal. */
  handRaised: boolean
  callView: boolean
  setCallView(next: boolean): void

  toggleMic(): void
  toggleCamera(): void
  toggleShare(): void
  toggleHand(): void
  react(reaction: Reaction): void
  leaveCall(): void

  /** What is being asked before a share starts. Null almost always. */
  asking: ShareQuestion | null
  /** Yes, take the slot. Opens the source list next where there is one. */
  confirmTakeOver(): void
  /** One source from a host's picker, chosen. */
  pickSource(sourceId: string): void
  /** No. Nothing is started and nobody else is affected. */
  cancelShare(): void
}

export function useCallControls(
  client: OfisClient,
  state: OfficeState,
  options: {
    available: boolean
    /**
     * A host's own list of screens and windows, on a platform that needs one.
     *
     * Absent on the web, which is the common case: the browser's picker is better
     * than anything we would draw and it is the only one that can offer a tab.
     */
    screenSources?: ScreenSourceProvider | null
  },
): CallControls {
  const announce = useAnnounce()

  /**
   * Whether the map or the call fills the window.
   *
   * Remembered, because somebody who works in call view should not have to choose
   * it again every time they join something.
   */
  const [callView, setCallView] = usePersisted('ofiskit:call-view', false)

  const roomId = yourRoom(state)
  const call = roomId ? callIn(state, roomId) : null

  /*
   * This device's own media, as the office sees it.
   *
   * Read from the office state rather than from the adapter, so the button and
   * everybody else's screen can never disagree: what is drawn here is exactly what
   * was broadcast, and the adapter reports its state to the server *after* it
   * actually managed to do the thing.
   */
  const mine = yourPresence(state)?.devices.find((device) => device.deviceId === state.you.deviceId)
  const inCall = Boolean(mine?.inCall)
  const muted = mine?.muted ?? true
  const cameraOn = mine?.cameraOn ?? false
  const sharing = mine?.sharing ?? false
  const handRaised = mine?.handRaisedAt != null

  /** Join with exactly what was pressed, and nothing else. */
  const joinWith = useCallback(
    (wanted: { audio: boolean; video: boolean }) => {
      void client.joinCall(wanted).then((result) => {
        // A refusal is announced rather than only drawn: the bar's disabled state
        // is a convenience, and the server is the authority.
        if (!result.ok) announce(result.message, 'assertive')
      })
    },
    [announce, client],
  )

  const toggleMic = useCallback(() => {
    // Not in the call: pressing the microphone joins with audio, and the camera
    // stays off until somebody presses it.
    if (!inCall) return joinWith({ audio: true, video: false })
    void client.rtc.setMicrophone(muted)
  }, [client, inCall, joinWith, muted])

  const toggleCamera = useCallback(() => {
    // And pressing the camera joins with video and no microphone, which is what
    // somebody joining to show something wants.
    if (!inCall) return joinWith({ audio: false, video: true })
    void client.rtc.setCamera(!cameraOn)
  }, [cameraOn, client, inCall, joinWith])

  /*
   * Sharing, in three steps that are usually one.
   *
   * On the web, pressing the button opens the browser's picker and that is the whole
   * interaction. The other two steps exist because a call has one screen slot —
   * taking it from somebody is worth asking about — and because a desktop shell has
   * to draw its own list of windows. Both are questions, held here, and neither
   * changes what `start` does.
   */
  const [asking, setAsking] = useState<ShareQuestion | null>(null)
  const sharedBy = roomId ? sharerIn(state, roomId) : null
  const sharedByOther =
    sharedBy && sharedBy.deviceId !== state.you.deviceId ? sharedBy.displayName : null

  const start = useCallback(
    (sourceId?: string) => {
      setAsking(null)

      const share = () => {
        // Nothing to do with the result: a share that started is announced to
        // everybody by the call itself, and a picker somebody closed is not a
        // failure and says nothing. A capture that failed has already said so.
        void client.rtc.startScreenShare(sourceId === undefined ? undefined : { sourceId })
      }

      if (inCall) return share()

      // Sharing is joining, like the microphone and the camera. Audio off: somebody
      // sharing a screen has not asked to be heard yet.
      void client.joinCall({ audio: false, video: false }).then((result) => {
        if (!result.ok) return announce(result.message, 'assertive')
        share()
      })
    },
    [announce, client, inCall, setAsking],
  )

  /** Open the host's list, where there is a host with one. */
  const chooseSource = useCallback(
    (sources: ScreenSourceProvider) => {
      void sources
        .list()
        // An empty list is not a failure: the picker says so and offers a way out,
        // which is better than a button that appears to do nothing.
        .catch(() => [])
        .then((list) => setAsking({ kind: 'sources', list }))
    },
    [setAsking],
  )

  const toggleShare = useCallback(() => {
    if (sharing) {
      void client.rtc.stopScreenShare()
      return
    }

    // Somebody else has the slot. Asked, not refused: the person who wants to show
    // something next is usually right that they do.
    if (sharedByOther !== null) {
      setAsking({ kind: 'take-over', sharerName: sharedByOther })
      return
    }

    const sources = options.screenSources
    if (sources) return chooseSource(sources)
    start()
  }, [chooseSource, client, options.screenSources, sharedByOther, setAsking, sharing, start])

  const confirmTakeOver = useCallback(() => {
    const sources = options.screenSources
    // The slot is not claimed here. It is claimed by the share actually starting,
    // which is the only moment at which there is something to put in it — asking
    // first would take somebody's screen down for a picker that gets cancelled.
    if (sources) return chooseSource(sources)
    start()
  }, [chooseSource, options.screenSources, start])

  /**
   * A hand up, or down. No media involved at either end.
   *
   * Which is the property worth keeping: it is a socket event, so it behaves the
   * same on the built-in provider and on anybody else's, and it loads no provider
   * SDK to do it. The office state is what says whether the hand is up, so the
   * button can never disagree with what everybody else can see.
   */
  const toggleHand = useCallback(() => {
    void client.raiseHand(!handRaised)
  }, [client, handRaised])

  /**
   * React, and say so if the server refused.
   *
   * The refusal is the rate limit, which is the one thing somebody pressing this
   * repeatedly needs told — a button that silently stops working looks broken.
   */
  const react = useCallback(
    (reaction: Reaction) => {
      void client.react(reaction).then((result) => {
        if (!result.ok) announce(result.message, 'assertive')
      })
    },
    [announce, client],
  )

  const leaveCall = useCallback(() => {
    void client.leaveCall()
    // Back to the office. Staying in call view with no call in it is a blank
    // screen with a button on it.
    setCallView(false)
  }, [client, setCallView])

  return {
    available: options.available,
    inCall,
    muted,
    cameraOn,
    sharing,
    sharedByOther,
    call,
    handRaised,
    // Call view is only ever shown when there is a call to show. Otherwise the
    // remembered preference would open somebody into an empty grid.
    callView: callView && inCall,
    setCallView,
    toggleMic,
    toggleCamera,
    toggleShare,
    toggleHand,
    react,
    leaveCall,
    asking,
    confirmTakeOver,
    pickSource: start,
    cancelShare: () => setAsking(null),
  }
}
