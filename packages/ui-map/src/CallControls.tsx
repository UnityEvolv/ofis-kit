import { Icon, Popover } from '@unityevolv/unitykit'
import type { Reaction, RoomCall } from '@unityevolv/ofiskit-realtime-client'
import { useEffect } from 'react'

import { Control, controlClasses } from './controls.js'
import { ReactionPicker } from './Reactions.js'

/**
 * The bar at the bottom of the office, where a call starts, is controlled and ends.
 *
 * It speaks to the provider through the shared realtime client, so it looks and
 * behaves identically whichever provider an org uses and never knows whether the
 * call is a peer-to-peer mesh or somebody's SFU.
 *
 * The rule that catches people out: **entering a room never joins its call.**
 * Pressing the microphone or the camera is what joins, and the other one stays off
 * until it is pressed too.
 *
 * The bar itself is always there, because in this app it is the only chrome — the
 * map fills the window and there is no header. The **call** controls are what comes
 * and goes, since reception and the break room never have calls, and the `leading`
 * and `trailing` slots carry whatever else the host needs within reach: the status
 * control, a view toggle, a way out.
 */

export interface CallControlsProps {
  /** False in reception and the break room, which never have calls. */
  available: boolean
  /** Sits at the left of the bar. The status control goes here. */
  leading?: React.ReactNode
  /** Sits at the right: view toggles, and leaving the office. */
  trailing?: React.ReactNode
  inCall: boolean
  muted: boolean
  cameraOn: boolean
  sharing: boolean
  /**
   * Somebody else's name, when they are the one sharing.
   *
   * Only so the control can say what pressing it would do. There is one share per
   * call, so pressing it here means taking the slot, and a button labelled "Share
   * your screen" that silently ends somebody else's is the kind of surprise this
   * bar exists to avoid.
   */
  sharedByOther?: string | null
  callView: boolean
  call: RoomCall | null
  /** Your own hand, so the control can say whether pressing it puts it up or down. */
  handRaised: boolean
  /** Set when a control cannot be used, and shown rather than hiding it. */
  disabledReason?: string | null

  onToggleMic(): void
  onToggleCamera(): void
  onToggleShare(): void
  onToggleHand(): void
  onReact(reaction: Reaction): void
  onToggleCallView(): void
  onLeaveCall(): void
  onOpenDevices(): void
}

export function CallControls(props: CallControlsProps) {
  const { available, inCall, muted, cameraOn, sharing, sharedByOther, callView, call, handRaised } =
    props

  // Full is about the call rather than the room, and about other people rather
  // than you: somebody already in it is never told it is full.
  const full = call !== null && call.participants.length >= call.limit && !inCall
  const reason = props.disabledReason ?? (full ? `This call is full (${call?.limit} people).` : null)
  const blocked = Boolean(reason)

  /**
   * Shortcuts for the two controls people press constantly.
   *
   * Ignored while typing, so pressing M in a status box does not mute somebody
   * mid-sentence, and ignored with a modifier held, so browser shortcuts still
   * work.
   */
  const { onToggleMic, onToggleCamera } = props
  useEffect(() => {
    if (!available || blocked) return

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault()
        onToggleMic()
      }
      if (event.key === 'v' || event.key === 'V') {
        event.preventDefault()
        onToggleCamera()
      }
    }

    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [available, blocked, onToggleMic, onToggleCamera])

  return (
    <div
      role="toolbar"
      aria-label="Office controls"
      className="flex w-full items-center gap-1 border-t border-base-300 bg-base-100 px-2 py-1.5"
    >
      {props.leading}

      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1">
        {available && (
          <>
            {/*
              Pressing either of these joins the call. The label says what will
              happen rather than what is true now, because a control that reads
              "Mute" while you are not in the call is a control that lies.
            */}
            <Control
              label={inCall && !muted ? 'Mute microphone' : 'Turn on microphone'}
              hint="M"
              icon={inCall && !muted ? 'mic' : 'mic-off'}
              active={inCall && !muted}
              danger={inCall && muted}
              disabled={blocked}
              reason={reason}
              onClick={props.onToggleMic}
            />

            <Control
              label={cameraOn ? 'Turn off camera' : 'Turn on camera'}
              hint="V"
              icon={cameraOn ? 'video' : 'video-off'}
              active={cameraOn}
              disabled={blocked}
              reason={reason}
              onClick={props.onToggleCamera}
            />

            {/*
              Sharing, and taking over.
              
              One slot per call, so pressing this while somebody else is sharing is
              a different act with a different label: it ends their share. It is not
              disabled for it — asking is the right answer, because the person who
              needs to show something next is usually right that they do — and the
              question itself is the host's to ask, since the host is what knows
              whether there is a picker to open first.
            */}
            <Control
              label={
                sharing
                  ? 'Stop sharing your screen'
                  : sharedByOther
                    ? 'Share your screen instead'
                    : 'Share your screen'
              }
              icon="share"
              active={sharing}
              disabled={blocked}
              reason={reason}
              onClick={props.onToggleShare}
            />

            {/*
              The two signals that need no media, and are the reason they sit
              beside the microphone rather than somewhere else: asking to speak and
              reacting are what somebody does *instead* of unmuting.

              Only while in the call. A hand raised by somebody who is not in the
              conversation is a hand nobody in it can see, and the server refuses
              it — so the control is absent rather than offering to fail.
            */}
            {inCall && (
              <>
                <Control
                  label={handRaised ? 'Lower your hand' : 'Raise your hand'}
                  icon="raise-hand"
                  active={handRaised}
                  onClick={props.onToggleHand}
                />

                {/*
                  The trigger is a real button rather than a `Control` in a
                  wrapper: the popover opens the panel itself, and a button inside
                  a span would be two things to press where there should be one.
                */}
                <Popover
                  width="auto"
                  trigger={
                    <button type="button" aria-label="React" className={controlClasses({})}>
                      <Icon name="reactions" size="sm" />
                    </button>
                  }
                >
                  <ReactionPicker onReact={props.onReact} />
                </Popover>
              </>
            )}

            <Control
              label="Microphone, camera and speaker"
              icon="settings"
              onClick={props.onOpenDevices}
            />

            <span className="mx-1 h-5 w-px bg-base-300" aria-hidden="true" />

            <Control
              label={callView ? 'Show the office map' : 'Show the call full size'}
              icon="call-view"
              active={callView}
              onClick={props.onToggleCallView}
            />

            {inCall && (
              <>
                <span className="mx-1 h-5 w-px bg-base-300" aria-hidden="true" />
                <button
                  type="button"
                  onClick={props.onLeaveCall}
                  className="inline-flex items-center gap-1 rounded-lg bg-error px-2.5 py-1.5 text-sm font-medium text-error-content hover:bg-error/90 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <Icon name="leave-call" size="sm" />
                  Leave call
                </button>
              </>
            )}

            {/*
              The reason lives beside the controls rather than only in a tooltip: a
              tooltip is invisible on a touch screen, and "why is this greyed out"
              is the question this row exists to answer.
            */}
            {reason && (
              <p className="w-full text-center text-[11px] text-base-content/70" role="note">
                {reason}
              </p>
            )}
          </>
        )}
      </div>

      {props.trailing}
    </div>
  )
}
