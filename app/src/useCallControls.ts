import type { OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { callIn, you as yourPresence, yourRoom } from '@unityevolv/ofiskit-realtime-client'
import { useAnnounce, usePersisted } from '@unityevolv/ofiskit-ui-map'
import type { OfficeState } from '@unityevolv/ofiskit-realtime-client'
import type { Reaction, RoomCall } from '@unityevolv/ofiskit-realtime-client'
import { useCallback } from 'react'

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

export interface CallControls {
  /** False in reception and the break room, which never have calls. */
  available: boolean
  inCall: boolean
  muted: boolean
  cameraOn: boolean
  sharing: boolean
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
}

export function useCallControls(
  client: OfisClient,
  state: OfficeState,
  options: { available: boolean },
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

  const toggleShare = useCallback(() => {
    if (sharing) {
      void client.rtc.stopScreenShare()
      return
    }

    const share = () => {
      void client.rtc.startScreenShare().then((started) => {
        // A share fills the window, because a share nobody can read is not worth
        // sharing. The picker being cancelled is not a failure and says nothing.
        if (started) setCallView(true)
      })
    }

    if (!inCall) {
      // Sharing is joining, like the other two. Audio off: somebody sharing a
      // screen has not asked to be heard yet.
      void client.joinCall({ audio: false, video: false }).then((result) => {
        if (!result.ok) return announce(result.message, 'assertive')
        share()
      })
      return
    }

    share()
  }, [announce, client, inCall, setCallView, sharing])

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
  }
}
