import { Button, Dropdown } from '@unityevolv/unitykit'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  ReactNode,
  SyntheticEvent,
} from 'react'

import { useAnnounce } from './Announcer.js'

/**
 * Actions the host adds to a person or a room.
 *
 * The engine draws the office; what somebody can *do* to a colleague or a room
 * beyond walking in is the host's business — book it, message them, pin them —
 * and none of it exists here. So the host hands over a list of labelled
 * callbacks and the engine offers them where the person or the room is: a menu
 * on right-click, on a long press, and from the keyboard, plus a visible button
 * in the list view so nothing depends on knowing a gesture.
 *
 * A disabled action stays visible with its reason, the same rule the room bar
 * follows for its own controls: a control that vanishes teaches nobody anything.
 * The host's server still refuses the action independently; the disabled state is
 * a convenience, never the control.
 */
export interface HostAction {
  /** Stable across renders: the menu keys by it. */
  id: string
  label: string
  /** Why it cannot be used right now. Shown as the disabled item's hint and announced with it. */
  disabled?: string | null
  onSelect(): void
}

/** How long a finger has to stay down before it is a press rather than a tap. */
export const LONG_PRESS_MS = 500
/** A finger that travels further than this before the press lands is scrolling. */
const LONG_PRESS_SLOP_PX = 10

/** Marks the element a menu belongs to, so nested targets can tell whose gesture it is. */
const TARGET_ATTR = 'data-host-actions'

/** A control that can take focus, for the keyboard to land on when the menu closes. */
const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

export interface ActionMenuHandle {
  /** False when the host gave no actions, so a control can hide itself. */
  enabled: boolean
  expanded: boolean
  /** Open the menu. Focus goes back to `returnTo` when it closes. */
  open(returnTo?: HTMLElement | null): void
}

const ActionMenuContext = createContext<ActionMenuHandle>({
  enabled: false,
  expanded: false,
  open: () => {},
})

/** The menu of the nearest `ActionTarget`, for a control inside it that opens it. */
export function useActionMenu(): ActionMenuHandle {
  return useContext(ActionMenuContext)
}

export interface ActionTargetProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'li' | 'span'
  /** Who or what the actions are for: said when the menu opens, and the menu's name. */
  name: string
  /** The host's actions. None, or an empty list, and the element is left alone. */
  actions?: readonly HostAction[] | null
  children?: ReactNode
}

/**
 * Where the menu lands when it closes.
 *
 * Whatever had focus inside the target, if anything did; else the target itself
 * when it can take focus (a room on the map), else the first control inside it
 * (the row's own button in the list).
 */
function whereFocusReturns(target: HTMLElement): HTMLElement | null {
  const active = document.activeElement
  if (active instanceof HTMLElement && target.contains(active)) return active
  if (target.matches(FOCUSABLE)) return target
  return target.querySelector<HTMLElement>(FOCUSABLE)
}

/**
 * An element the host's actions hang off.
 *
 * Right-click, a long press on touch, and the ContextMenu key or Shift+F10
 * while something inside it is focused all open the same menu, anchored to the
 * element. With no actions the element is rendered as given, no gesture is
 * listened for, and the browser's own context menu is left alone.
 *
 * Targets nest — a person stands in a room — and the innermost one with actions
 * claims a gesture, so right-clicking a colleague never opens the room's menu.
 */
export function ActionTarget({
  as: Tag = 'div',
  name,
  actions,
  children,
  className,
  onContextMenu,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClickCapture,
  ...rest
}: ActionTargetProps) {
  const enabled = actions !== undefined && actions !== null && actions.length > 0
  const [open, setOpen] = useState(false)
  const announce = useAnnounce()

  const returnTo = useRef<HTMLElement | null>(null)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  // A long press that opened the menu must not also count as a tap on what is
  // under the finger when it lifts.
  const swallowClick = useRef(false)

  const cancelPress = useCallback(() => {
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }, [])
  useEffect(() => cancelPress, [cancelPress])

  // Read by the gesture handlers, which run between renders.
  const isOpen = useRef(false)
  const setOpenState = useCallback((next: boolean) => {
    isOpen.current = next
    setOpen(next)
  }, [])

  const openMenu = useCallback(
    (focusBack: HTMLElement | null | undefined) => {
      if (!enabled) return
      returnTo.current = focusBack ?? null
      // Android fires contextmenu at the end of the same long press that
      // already opened it; said once.
      if (isOpen.current) return
      setOpenState(true)
      announce(`Actions for ${name}.`)
    },
    [announce, enabled, name, setOpenState],
  )

  const handle = useMemo<ActionMenuHandle>(
    () => ({ enabled, expanded: open && enabled, open: openMenu }),
    [enabled, open, openMenu],
  )

  /**
   * Whether this gesture is ours.
   *
   * The innermost target with actions under the pointer or the focus claims it.
   * The menu itself is drawn in a portal, and React carries its events up through
   * here too; those have no target of ours above them in the document and are
   * ignored.
   */
  const claims = (event: SyntheticEvent<HTMLElement>) => {
    if (!enabled) return false
    const target = event.target
    return target instanceof Element && target.closest(`[${TARGET_ATTR}]`) === event.currentTarget
  }

  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    onContextMenu?.(event)
    if (!claims(event)) return
    event.preventDefault()
    openMenu(whereFocusReturns(event.currentTarget))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const menuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)
    if (menuKey && claims(event)) {
      event.preventDefault()
      openMenu(event.target instanceof HTMLElement ? event.target : event.currentTarget)
      return
    }
    onKeyDown?.(event)
  }

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    onPointerDown?.(event)
    swallowClick.current = false
    cancelPress()
    // A long press is a touch gesture. A mouse has a right button, and a mouse
    // held down is a drag.
    const touch = event.pointerType === 'touch' || event.pointerType === 'pen'
    if (!touch || !event.isPrimary || !claims(event)) return
    const { currentTarget, clientX, clientY } = event
    press.current = {
      x: clientX,
      y: clientY,
      timer: setTimeout(() => {
        press.current = null
        swallowClick.current = true
        openMenu(whereFocusReturns(currentTarget))
      }, LONG_PRESS_MS),
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    onPointerMove?.(event)
    const started = press.current
    if (!started) return
    if (Math.hypot(event.clientX - started.x, event.clientY - started.y) > LONG_PRESS_SLOP_PX) {
      cancelPress()
    }
  }

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    onPointerUp?.(event)
    cancelPress()
  }

  const handlePointerCancel = (event: PointerEvent<HTMLElement>) => {
    onPointerCancel?.(event)
    cancelPress()
  }

  const handleClickCapture = (event: MouseEvent<HTMLElement>) => {
    onClickCapture?.(event)
    if (!swallowClick.current) return
    swallowClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  if (!enabled) {
    return (
      <Tag
        className={className}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
        {...rest}
      >
        {children}
      </Tag>
    )
  }

  return (
    <Tag
      data-host-actions=""
      // No callout over the picture on a long press: the press is ours.
      className={[className ?? '', '[-webkit-touch-callout:none]'].join(' ').trim()}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={handleClickCapture}
      {...rest}
    >
      <ActionMenuContext.Provider value={handle}>
        {children}
        <ActionMenu
          name={name}
          actions={actions}
          open={open}
          onOpenChange={setOpenState}
          onClosedFocus={() => returnTo.current?.focus()}
        />
      </ActionMenuContext.Provider>
    </Tag>
  )
}

/**
 * The menu itself: the kit's Dropdown, opened by the target rather than by its
 * own trigger.
 *
 * The kit's Dropdown hangs off a trigger that opens on a left click, Enter,
 * Space and ArrowDown — the right thing for a menu button and the wrong thing
 * for an avatar whose click already does something else. So the trigger here is
 * an inert, invisible span laid over the target: it positions the menu, it
 * carries the menu's name, and it never opens anything. The target opens the
 * menu by state, and the kit does the rest — a `menu` of `menuitem`s, the arrow
 * keys, Home and End, type-ahead, Escape, click outside, and focus back to the
 * trigger when it closes, which the trigger hands on to whatever opened it.
 */
function ActionMenu({
  name,
  actions,
  open,
  onOpenChange,
  onClosedFocus,
}: {
  name: string
  actions: readonly HostAction[]
  open: boolean
  onOpenChange(open: boolean): void
  onClosedFocus(): void
}) {
  const hintId = useId()

  return (
    <Dropdown
      open={open}
      onOpenChange={onOpenChange}
      align="start"
      trigger={
        <span
          aria-hidden="true"
          tabIndex={-1}
          data-testid="action-menu-anchor"
          className="pointer-events-none absolute inset-0"
          onFocus={(event) => {
            onClosedFocus()
            // Nowhere to go: better nothing focused than a hidden span.
            if (document.activeElement === event.currentTarget) event.currentTarget.blur()
          }}
        >
          {/* The menu is labelled by its trigger; this is the label. */}
          <span className="sr-only">Actions for {name}</span>
        </span>
      }
    >
      {actions.map((action) => {
        const disabled = action.disabled !== undefined && action.disabled !== null
        const reason = disabled && action.disabled ? action.disabled : null
        const id = `${hintId}-${action.id}`
        return (
          <Dropdown.Item
            key={action.id}
            disabled={disabled}
            onSelect={action.onSelect}
            hint={
              reason ? (
                <span
                  id={id}
                  /*
                   * The reason is the item's description as well as its hint.
                   * The kit's item has no prop for it, so it is set from inside
                   * once the hint is mounted, the way the overflow counter names
                   * its popover. Worth moving into the kit.
                   */
                  ref={(node) => {
                    node?.closest('[role="menuitem"]')?.setAttribute('aria-describedby', id)
                  }}
                >
                  {reason}
                </span>
              ) : undefined
            }
          >
            {action.label}
          </Dropdown.Item>
        )
      })}
    </Dropdown>
  )
}

/**
 * A visible way in, for anybody who does not know the gesture.
 *
 * The list view puts one on every person and every room. Nothing in the menu is
 * reachable only by right-click, which is what makes the list the map's
 * accessible twin rather than a subset of it. Renders nothing when there is
 * nothing to open.
 */
export function MoreActionsButton({
  label,
  size = 'xs',
  className,
}: {
  /** The accessible name: "More actions for Grace". */
  label: string
  size?: 'xs' | 'sm'
  className?: string
}) {
  const menu = useActionMenu()
  const button = useRef<HTMLButtonElement>(null)
  if (!menu.enabled) return null

  return (
    <Button
      ref={button}
      variant="ghost"
      size={size}
      icon="more"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={menu.expanded}
      className={className ?? 'shrink-0'}
      onClick={() => menu.open(button.current)}
    />
  )
}
