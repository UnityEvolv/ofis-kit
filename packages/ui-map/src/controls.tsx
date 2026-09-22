import { Icon, Tooltip } from '@unityevolv/unitykit'

/**
 * One look, and one set of manners, for every control in the office bar.
 *
 * Extracted because there are now three kinds of thing in that row — a plain
 * control, a popover trigger, and the share button with its own decisions — and a
 * second copy of these classes is how two buttons sitting beside each other end up
 * a pixel different from one another.
 */

export interface ControlProps {
  /**
   * What pressing it will do, rather than what is true now.
   *
   * The rule the whole bar follows: a control reading "Mute" while you are not in
   * the call is a control that lies, and this is the label a screen reader reads.
   */
  label: string
  icon:
    | 'mic'
    | 'mic-off'
    | 'video'
    | 'video-off'
    | 'share'
    | 'raise-hand'
    | 'reactions'
    | 'call-view'
    | 'settings'
  /** A keyboard shortcut, shown in the tooltip and never as a second label. */
  hint?: string
  active?: boolean
  danger?: boolean
  disabled?: boolean
  reason?: string | null
  onClick(): void
}

export function controlClasses({
  active,
  danger,
  disabled,
}: {
  active?: boolean
  danger?: boolean
  disabled?: boolean
}): string {
  return [
    // A touch smaller on the narrowest phones, where seven of them at full size do
    // not fit one row; 32px is still well over the 24px a tap target needs.
    'inline-flex h-9 w-9 items-center justify-center rounded-lg max-[340px]:h-8 max-[340px]:w-8',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
    disabled
      ? 'cursor-not-allowed opacity-40'
      : danger
        ? // Muted is a state worth noticing at a glance, because talking while
          // muted is the commonest thing that happens in any call product.
          'bg-error/15 text-error hover:bg-error/25'
        : active
          ? 'bg-primary text-primary-content hover:bg-primary/90'
          : 'hover:bg-base-200',
  ].join(' ')
}

export function Control({
  label,
  icon,
  hint,
  active,
  danger,
  disabled,
  reason,
  onClick,
}: ControlProps) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active ?? false}
      className={controlClasses({ active, danger, disabled })}
    >
      <Icon name={icon} size="sm" />
    </button>
  )

  return (
    <Tooltip content={disabled && reason ? reason : hint ? `${label} (${hint})` : label}>
      {button}
    </Tooltip>
  )
}
