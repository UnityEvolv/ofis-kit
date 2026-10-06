import { Button, Popover } from '@unityevolv/unitykit'
import type { PublicPresence } from '@unityevolv/ofiskit-realtime-client'
import { handRaised, isSharing } from '@unityevolv/ofiskit-realtime-client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'

import type { HostAction } from './HostActions.js'
import { StatusDot, describeStatus } from './status.js'

/**
 * A card about one person, with what the host lets you do to them.
 *
 * Hover an avatar and, after a moment, a card: their face, their name, their
 * status as the map already draws it, and the host's actions as buttons. It is
 * a hover card rather than a menu because the first thing somebody wants from
 * a face on the map is to be sure who it is and what they are up to, and only
 * then to do something; a menu answers the second question and not the first.
 *
 * Nothing is announced when it opens. It is not a thing happening *to* you: it
 * is you looking at somebody, and a live region saying so every time the
 * pointer crossed a face would be a chatterbox.
 */

/** How long the pointer rests on an avatar before the card appears. */
export const HOVER_OPEN_MS = 300
/** How long the pointer may be off both the avatar and the card before it goes. */
export const HOVER_CLOSE_MS = 150
/** A finger held this long on an avatar whose tap is the host's opens the card instead. */
export const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP_PX = 10

/** What can take focus in the card: the host's buttons. */
const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * One card open at a time.
 *
 * Two faces side by side and a pointer sweeping across them would otherwise
 * leave a trail of cards. The one opening closes the one before it.
 */
let closeTheOpenCard: (() => void) | null = null

/**
 * Give the popover's dialog the person's name.
 *
 * The kit's Popover renders Radix's content as `role="dialog"` and has no prop to
 * name it, so it is named from inside once the card is mounted, the way the
 * overflow counter names its popover. Worth moving into the kit.
 */
const nameTheDialog = (name: string) => (node: HTMLElement | null) => {
  node?.closest('[role="dialog"]')?.setAttribute('aria-label', name)
}

export interface PersonCardProps {
  person: PublicPresence
  /** The host's actions. The card is only drawn when there is at least one. */
  actions: readonly HostAction[]
  /** The avatar's accessible name, which the trigger carries. */
  label: string
  /**
   * The host's click, which keeps precedence: with one, a click does that and
   * the card opens on hover, on focus, and on a long press for touch. Without
   * one, a tap opens the card too.
   */
  onClick?: (() => void) | undefined
  /** The avatar, drawn as the card's anchor. */
  children: ReactNode
}

export function PersonCard({ person, actions, label, onClick, children }: PersonCardProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const hintId = useId()

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const swallowClick = useRef(false)
  const lastPointer = useRef<'mouse' | 'touch' | 'keyboard'>('mouse')
  /** A pointer is down on the avatar: the focus that brings is not the keyboard's. */
  const pressing = useRef(false)
  /** Mirrors `open` for the handlers, which run between renders. */
  const isOpen = useRef(false)
  /**
   * Set when the card closes, so the focus that comes back to the avatar does
   * not open it again. Cleared when focus leaves, so coming back does.
   */
  const justClosed = useRef(false)

  const clear = (timer: { current: ReturnType<typeof setTimeout> | null }) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const show = useCallback(() => {
    clear(closeTimer)
    if (isOpen.current) return
    closeTheOpenCard?.()
    isOpen.current = true
    setOpen(true)
  }, [])

  const hide = useCallback(() => {
    clear(openTimer)
    clear(closeTimer)
    if (!isOpen.current) return
    // Only when focus is here, or about to come back here from the card:
    // closed from elsewhere, the next focus is a fresh arrival.
    const active = document.activeElement
    justClosed.current = trigger.current === active || (card.current?.contains(active) ?? false)
    isOpen.current = false
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return
    closeTheOpenCard = hide
    return () => {
      if (closeTheOpenCard === hide) closeTheOpenCard = null
    }
  }, [open, hide])

  useEffect(
    () => () => {
      clear(openTimer)
      clear(closeTimer)
      if (press.current) clearTimeout(press.current.timer)
    },
    [],
  )

  /**
   * The pointer has left the avatar or the card. Close in a moment, unless it
   * lands on the other one first, or the keyboard is in the card.
   */
  const leave = () => {
    clear(openTimer)
    if (!open) return
    clear(closeTimer)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      const active = document.activeElement
      if (card.current?.contains(active) || trigger.current === active) return
      hide()
    }, HOVER_CLOSE_MS)
  }

  const onTriggerPointerEnter = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse') return
    clear(closeTimer)
    if (open || openTimer.current) return
    openTimer.current = setTimeout(() => {
      openTimer.current = null
      show()
    }, HOVER_OPEN_MS)
  }

  const onTriggerPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    lastPointer.current =
      event.pointerType === 'touch' || event.pointerType === 'pen' ? 'touch' : 'mouse'
    pressing.current = true
    swallowClick.current = false
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
    // A held finger is the touch way in when a tap is the host's. Without a
    // host click, a tap already opens the card and a press is just a slow tap.
    if (lastPointer.current !== 'touch' || !onClick || !event.isPrimary) return
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        press.current = null
        swallowClick.current = true
        show()
      }, LONG_PRESS_MS),
    }
  }

  const onTriggerPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const started = press.current
    if (!started) return
    if (Math.hypot(event.clientX - started.x, event.clientY - started.y) > LONG_PRESS_SLOP_PX) {
      clearTimeout(started.timer)
      press.current = null
    }
  }

  const cancelPress = () => {
    pressing.current = false
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }

  /**
   * A click on the avatar.
   *
   * The kit's Popover would toggle the card on every click; `preventDefault`
   * is what stops it, so the click can mean what it should: the host's own
   * thing when the host has one, otherwise opening the card — and, from a
   * finger, closing it again, since a finger has no hover to leave.
   */
  const onTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    if (onClick) {
      onClick()
      return
    }
    if (!open) {
      show()
      return
    }
    if (lastPointer.current === 'touch') hide()
    else if (lastPointer.current === 'keyboard') focusFirstInCard()
  }

  const focusFirstInCard = () => {
    card.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }

  const onTriggerFocus = () => {
    // Focus from a press is the press's business: a tap opens by its click
    // and closes by its next, and a mouse opens by hovering.
    if (pressing.current || justClosed.current) return
    show()
  }

  const onTriggerBlur = () => {
    justClosed.current = false
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    lastPointer.current = 'keyboard'
    // Tab walks into the card, which is drawn elsewhere in the page and would
    // otherwise be skipped over.
    if (event.key === 'Tab' && !event.shiftKey && open && card.current?.querySelector(FOCUSABLE)) {
      event.preventDefault()
      focusFirstInCard()
    }
  }

  /**
   * Tab past the last button leaves the card and carries on from the avatar;
   * Shift+Tab before the first goes back to it. Escape is the kit's, and gives
   * focus back to the avatar.
   */
  const onCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const focusable = [...(card.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && event.target === first) {
      event.preventDefault()
      trigger.current?.focus()
      return
    }
    if (!event.shiftKey && event.target === last) {
      event.preventDefault()
      const anchor = trigger.current
      hide()
      if (!anchor) return
      const everything = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (one) => !card.current?.contains(one),
      )
      const next = everything[everything.indexOf(anchor) + 1]
      ;(next ?? anchor).focus()
    }
  }

  const face = 40
  const inCall = person.devices.some((device) => device.inCall)
  const doing = [
    inCall ? 'In a call' : '',
    isSharing(person) ? 'Sharing their screen' : '',
    handRaised(person) ? 'Hand raised' : '',
  ].filter(Boolean)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? show() : hide())}
      side="bottom"
      align="center"
      width="sm"
      autoFocusContent={false}
      trigger={
        <button
          ref={trigger}
          type="button"
          className="cursor-pointer"
          aria-label={label}
          // A hole in the room's menu target: see `ActionTarget`.
          data-host-actions="none"
          onClick={onTriggerClick}
          onPointerEnter={onTriggerPointerEnter}
          onPointerLeave={(event) => {
            cancelPress()
            if (event.pointerType === 'mouse') leave()
          }}
          onPointerDown={onTriggerPointerDown}
          onPointerMove={onTriggerPointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onFocus={onTriggerFocus}
          onBlur={onTriggerBlur}
          onKeyDown={onTriggerKeyDown}
        >
          {children}
        </button>
      }
    >
      <div
        ref={card}
        data-testid="person-card"
        className="flex flex-col gap-3"
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') clear(closeTimer)
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') leave()
        }}
        onKeyDown={onCardKeyDown}
      >
        <div ref={nameTheDialog(person.displayName)} className="flex items-center gap-3">
          {person.photoUrl ? (
            <img
              src={person.photoUrl}
              alt=""
              className="shrink-0 rounded-full bg-base-200 object-cover ring-1 ring-base-300"
              style={{ width: face, height: face }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid shrink-0 place-items-center rounded-full bg-base-300 text-sm font-semibold text-base-content ring-1 ring-base-300"
              style={{ width: face, height: face }}
            >
              {initials(person.displayName)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-base-content">{person.displayName}</p>
            <p className="flex items-center gap-1 text-xs text-base-content/70">
              <StatusDot status={person.status} size={10} labelled={false} />
              <span className="truncate">{describeStatus(person.status, person.custom)}</span>
            </p>
            {doing.length > 0 && <p className="text-xs text-base-content/70">{doing.join(', ')}</p>}
          </div>
        </div>

        <ul className="flex flex-col gap-1.5" aria-label={`Actions for ${person.displayName}`}>
          {actions.map((action) => {
            const reason =
              action.disabled !== undefined && action.disabled !== null ? action.disabled : null
            const id = `${hintId}-${action.id}`
            return (
              <li key={action.id} className="flex flex-col gap-0.5">
                <Button
                  size="sm"
                  variant="secondary"
                  fullWidth
                  disabled={reason !== null}
                  onClick={() => {
                    action.onSelect()
                    hide()
                  }}
                  {...(reason ? { 'aria-describedby': id } : {})}
                >
                  {action.label}
                </Button>
                {reason && (
                  <p id={id} className="text-xs text-base-content/70">
                    {reason}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </Popover>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}
