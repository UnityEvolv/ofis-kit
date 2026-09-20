import { Tooltip } from '@unityevolv/unitykit'
import type { PublicPresence } from '@unityevolv/ofiskit-realtime-client'
import { isPhoneOnly } from '@unityevolv/ofiskit-realtime-client'

import { StatusDot, describeStatus } from './status.js'

/**
 * One person, standing in a room.
 *
 * Drawn as a kit surface rather than straight onto the background image: the
 * image is whatever an author generated, and nothing legible can be guaranteed on
 * top of it. Everything here has its own background and its own contrast in both
 * themes.
 */

export interface PersonAvatarProps {
  person: PublicPresence
  /** The avatar cell's width in pixels, from the template's avatar size. */
  size: number
  /**
   * Which of this person's devices this avatar is for.
   *
   * Somebody here on two devices is drawn twice, one avatar per device, because
   * each is a real screen with its own camera and microphone. Both are the same
   * person, and the pair says so.
   */
  deviceId?: string
  /** Linked to another avatar for the same person, so the pair reads as one. */
  linked?: boolean
  onClick?(): void
}

/**
 * A phone, drawn here rather than imported.
 *
 * The kit's icon set has no phone in it, and `ofiskit/no-lucide-direct` exists to
 * stop anybody reaching around the kit for one — an icon from outside is a
 * different weight from every other icon in the product. Drawn inline instead, in
 * `currentColor`, which is the same thing `status.tsx` does for the status shapes
 * and for the same reason. It is decoration: the avatar's label already says "on a
 * phone".
 */
function PhoneGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" focusable="false">
      <rect
        x="3.25"
        y="1"
        width="5.5"
        height="10"
        rx="1.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <rect x="5" y="9" width="2" height="0.9" rx="0.45" fill="currentColor" />
    </svg>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

export function PersonAvatar({
  person,
  size,
  deviceId,
  linked = false,
  onClick,
}: PersonAvatarProps) {
  const device = deviceId ? person.devices.find((one) => one.deviceId === deviceId) : undefined
  const reconnecting = person.status === 'reconnecting'

  const face = Math.round(size * 0.62)
  const description = describeStatus(person.status, person.custom)

  /**
   * One label carrying everything the picture says.
   *
   * Drawing is not telling: a badge in the corner of an avatar is invisible to a
   * screen reader unless it is in here, and status is the whole reason somebody
   * decides whether to walk into a room.
   */
  const label = [
    person.displayName,
    description,
    linked ? `also here on another device${device ? ` (this one is ${device.kind})` : ''}` : '',
    isPhoneOnly(person) ? 'on a phone' : '',
  ]
    .filter(Boolean)
    .join(', ')

  const body = (
    <span
      className="flex select-none flex-col items-center gap-1"
      style={{ width: size }}
      data-testid="person-avatar"
    >
      <span className="relative inline-flex" style={{ width: face, height: face }}>
        {/*
          The link between two avatars for one person is a ring, drawn as a
          sibling rather than a border so it cannot change the avatar's size and
          shift everything around it.
        */}
        {linked && (
          <span
            aria-hidden="true"
            className="absolute -inset-1 rounded-full ring-2 ring-primary/50"
          />
        )}

        {person.photoUrl ? (
          <img
            src={person.photoUrl}
            alt=""
            className={[
              'rounded-full bg-base-200 object-cover ring-1 ring-base-300',
              reconnecting ? 'opacity-50' : '',
            ].join(' ')}
            style={{ width: face, height: face }}
          />
        ) : (
          <span
            aria-hidden="true"
            className={[
              'grid place-items-center rounded-full bg-base-300 font-semibold text-base-content ring-1 ring-base-300',
              reconnecting ? 'opacity-50' : '',
            ].join(' ')}
            style={{ width: face, height: face, fontSize: Math.max(10, face * 0.38) }}
          >
            {initials(person.displayName)}
          </span>
        )}

        {/* Status sits on the avatar, with its own surface so it stays legible. */}
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-base-100 p-px leading-none">
          <StatusDot status={person.status} size={Math.max(9, face * 0.3)} labelled={false} />
        </span>

        {/*
          The device badge is the only way to tell somebody is on a phone, since
          presence is per user. No badge when a laptop is among their devices,
          because then it says nothing useful.
        */}
        {isPhoneOnly(person) && (
          <span className="absolute -bottom-1 -left-1 rounded-full bg-base-100 p-0.5 leading-none text-base-content/70">
            <PhoneGlyph size={Math.max(8, face * 0.26)} />
          </span>
        )}
      </span>

      <span
        className={[
          'max-w-full truncate rounded px-1 text-center leading-tight',
          'bg-base-100/85 text-base-content backdrop-blur-[2px]',
          linked ? 'ring-1 ring-primary/60' : '',
        ].join(' ')}
        style={{ fontSize: Math.max(9, size * 0.17) }}
      >
        {person.displayName}
      </span>
    </span>
  )

  const content = onClick ? (
    <button type="button" onClick={onClick} className="cursor-pointer" aria-label={label}>
      {body}
    </button>
  ) : (
    <span role="img" aria-label={label}>
      {body}
    </span>
  )

  // The custom status is shown on hover on the web, so the map is not covered in
  // text while still carrying it for anybody who wants it.
  return person.custom?.text ? <Tooltip content={description}>{content}</Tooltip> : content
}
