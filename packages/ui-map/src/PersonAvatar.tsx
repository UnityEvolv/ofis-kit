import { Icon, Tooltip } from '@unityevolv/unitykit'
import type { PublicPresence } from '@unityevolv/ofiskit-realtime-client'
import { handRaised, isMuted, isPhoneOnly, isSharing, isSpeaking } from '@unityevolv/ofiskit-realtime-client'

import { ReactionFloat } from './Reactions.js'
import { StatusDot, describeStatus } from './status.js'
import type { LiveReaction } from './useCall.js'

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
  /** Drops the pulse on the speaking ring. The ring itself stays. */
  reducedMotion?: boolean
  /** What is in the air over this person right now. From `useReactions`. */
  reactions?: readonly LiveReaction[]
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
  reducedMotion = false,
  reactions,
  onClick,
}: PersonAvatarProps) {
  const device = deviceId ? person.devices.find((one) => one.deviceId === deviceId) : undefined
  const reconnecting = person.status === 'reconnecting'

  /*
   * What the call looks like from the map.
   *
   * Per device where this avatar *is* a device, and across the person otherwise —
   * somebody drawn once while in the call from a laptop and a phone is speaking if
   * either of them is, and muted only if both are.
   */
  const speaking = device ? device.inCall && device.speaking : isSpeaking(person)
  const microphoneOff = device ? device.inCall && device.muted : isMuted(person)
  const sharing = device ? device.sharing : isSharing(person)
  const hand = device ? device.inCall && device.handRaisedAt !== null : handRaised(person)

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
    // Every badge drawn in a corner of this avatar, said. A ring on a picture is
    // invisible to a screen reader, and "who is talking" is most of what somebody
    // wants from a room they cannot see.
    hand ? 'hand raised' : '',
    sharing ? 'sharing their screen' : '',
    microphoneOff ? 'microphone off' : '',
    speaking ? 'speaking' : '',
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
        {/* Over the face, and only for a few seconds. Nothing about it is stored. */}
        <ReactionFloat reactions={reactions ?? []} size={Math.max(16, Math.round(face * 0.5))} />

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

        {/*
          The speaking ring, drawn as a sibling rather than a border so it cannot
          change the avatar's size and shift everything around it.

          Reduced motion keeps the ring and drops the pulse: the information is in
          the ring, and the pulsing is the part that makes some people feel unwell.
        */}
        {speaking && (
          <span
            aria-hidden="true"
            className={[
              'absolute -inset-1 rounded-full ring-2 ring-primary',
              reducedMotion ? '' : 'animate-pulse',
            ].join(' ')}
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

        {/*
          A hand up, above the head, which is where a hand goes.

          The one badge drawn outside the avatar's circle rather than in a corner of
          it: from across the map a raised hand is the thing somebody most needs to
          notice, and a corner badge among three other corner badges is not
          noticed.
        */}
        {hand && (
          <span
            aria-hidden="true"
            className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-base-100 px-0.5 leading-none text-primary"
          >
            <Icon name="raise-hand" size="xs" />
          </span>
        )}

        {/*
          Sharing, top right.

          Worth knowing from outside the room: somebody presenting is mid-sentence
          in a way somebody merely in a call is not.
        */}
        {sharing && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 rounded-full bg-base-100 p-0.5 leading-none text-primary"
          >
            <Icon name="share" size="xs" />
          </span>
        )}

        {/*
          The microphone, top left, and only ever when it is off.

          A badge for "unmuted" would be on almost every avatar in a call and would
          say nothing; the one worth drawing is the one that explains the silence.
          Both of these are decoration — the label above says the same thing, which
          is the half a ring on a picture cannot do.
        */}
        {microphoneOff && (
          <span
            aria-hidden="true"
            className="absolute -left-1 -top-1 rounded-full bg-base-100 p-0.5 leading-none text-base-content/70"
          >
            <Icon name="mic-off" size="xs" />
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
