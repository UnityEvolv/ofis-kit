import { Button, Checkbox, Icon, Popover } from '@unityevolv/unitykit'
import type { FollowState } from '@unityevolv/ofiskit-realtime-client'
import { useState } from 'react'

/**
 * Following, as each of the two people sees it.
 *
 * Asked for and answered: a card for whoever is asked, with yes and not now. Then
 * two things that stay on screen for as long as it lasts — the follower's "you
 * are following" with a stop that is always there, and the followed person's list
 * of who is behind them, with a stop against each. Being followed without knowing
 * it is the failure this feature exists to avoid, so neither is ever tucked into
 * a menu.
 */

export interface IncomingFollowRequest {
  requestId: string
  userId: string
  displayName: string
  photoUrl?: string
}

export interface FollowRequestDockProps {
  requests: readonly IncomingFollowRequest[]
  /**
   * `remember` is the person's "do not ask me again for them". Only offered when
   * the host passes `rememberLabel`, because remembering is the host's: the
   * engine's own default is for this session only, and it keeps nothing.
   */
  onAccept(requestId: string, remember: boolean): void
  onDecline(requestId: string): void
  rememberLabel?: string
}

export function FollowRequestDock({
  requests,
  onAccept,
  onDecline,
  rememberLabel,
}: FollowRequestDockProps) {
  if (requests.length === 0) return null
  return (
    <section
      className="pointer-events-auto flex w-72 flex-col gap-2"
      aria-label="Asking to follow you"
      data-testid="follow-requests"
    >
      {requests.map((request) => (
        <FollowRequestCard
          key={request.requestId}
          request={request}
          onAccept={(remember) => onAccept(request.requestId, remember)}
          onDecline={() => onDecline(request.requestId)}
          {...(rememberLabel ? { rememberLabel } : {})}
        />
      ))}
    </section>
  )
}

function FollowRequestCard(props: {
  request: IncomingFollowRequest
  onAccept(remember: boolean): void
  onDecline(): void
  rememberLabel?: string
}) {
  const { request, onAccept, onDecline, rememberLabel } = props
  const [remember, setRemember] = useState(false)
  return (
    <div
      className="rounded-lg bg-base-100 p-3 shadow-lg ring-1 ring-base-300"
      data-testid={`follow-request-${request.requestId}`}
    >
      <p className="flex items-center gap-2 text-sm">
        <Icon name="users" size="sm" />
        <span>
          <strong>{request.displayName}</strong> would like to follow you around the office.
        </span>
      </p>
      <p className="mt-1 text-xs text-base-content/70">
        They move into each room you enter, until either of you stops it.
      </p>
      {rememberLabel && (
        <div className="mt-2">
          <Checkbox
            size="sm"
            label={rememberLabel}
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => onAccept(remember)}>
          Let them follow
        </Button>
        <Button size="sm" variant="ghost" onClick={onDecline}>
          Not now
        </Button>
      </div>
    </div>
  )
}

export interface FollowingBarProps {
  follow: FollowState
  /** A person's name from their id, from the office state. */
  nameOf(userId: string): string
  /** A room's name, for "waiting to follow into Library". */
  roomName(roomId: string): string
  onStop(): void
}

/**
 * "Following Priya" and a stop, for as long as it lasts.
 *
 * In the app's own chrome rather than in a menu, because the way out of being
 * moved around has to be in plain sight. Also covers the moment before: a request
 * still waiting, which the same button withdraws. Nothing is drawn otherwise.
 */
export function FollowingBar({ follow, nameOf, roomName, onStop }: FollowingBarProps) {
  const following = follow.following
  const asking = follow.asking
  if (!following && !asking) return null

  const text = following
    ? following.waitingFor
      ? `Following ${nameOf(following.userId)} — into ${roomName(following.waitingFor.roomId)} when your call ends`
      : `Following ${nameOf(following.userId)}`
    : `Asked to follow ${nameOf(asking?.userId ?? '')}…`

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1 rounded-full bg-base-200 py-0.5 pl-2 pr-0.5 text-sm"
      data-testid="following-bar"
    >
      <Icon name="users" size="sm" />
      <span className="truncate">{text}</span>
      <Button size="xs" variant="ghost" onClick={onStop}>
        {following ? 'Stop following' : 'Withdraw'}
      </Button>
    </span>
  )
}

export interface FollowersControlProps {
  follow: FollowState
  nameOf(userId: string): string
  onRemove(userId: string): void
}

/**
 * Who is following you, and a stop against each.
 *
 * A button with the count that opens the list. Drawn whenever anybody is
 * following you and never otherwise, so its presence is itself the notice.
 */
export function FollowersControl({ follow, nameOf, onRemove }: FollowersControlProps) {
  const count = follow.followers.length
  if (count === 0) return null
  const summary = count === 1 ? '1 person following you' : `${count} people following you`

  return (
    <Popover
      side="top"
      align="end"
      width="sm"
      trigger={
        <Button size="sm" variant="ghost" data-testid="followers-control">
          <Icon name="users" size="sm" />
          <span>{summary}</span>
        </Button>
      }
    >
      <ul className="flex flex-col gap-1" aria-label="Following you">
        {follow.followers.map((one) => (
          <li key={one.userId} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{nameOf(one.userId)}</span>
            <Button
              size="xs"
              variant="danger"
              onClick={() => onRemove(one.userId)}
              aria-label={`Stop ${nameOf(one.userId)} following you`}
            >
              Stop
            </Button>
          </li>
        ))}
      </ul>
    </Popover>
  )
}
