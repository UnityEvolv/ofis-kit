import { Button, Icon, Select } from '@unityevolv/unitykit'
import type { DeviceChoice, OfisClient } from '@unityevolv/ofiskit-realtime-client'
import { statusIsChosen, you as yourPresence, yourRoom } from '@unityevolv/ofiskit-realtime-client'
import {
  CallAudio,
  CallControls,
  CallTiles,
  DevicePanel,
  KnockDock,
  OfficeMap,
  OutgoingKnock,
  RoomListView,
  StatusControl,
  ViewToggle,
  useAnnounce,
  useClientEvents,
  useIdleReporting,
  useOffice,
  usePersisted,
  useCallMedia,
  useSpeakerOrder,
  useTheme,
  type OfficeView,
} from '@unityevolv/ofiskit-ui-map'
import { tilePlacement } from '@unityevolv/ofiskit-ui-map'
import { hostsCalls, type Template } from '@unityevolv/ofiskit-template'
import { useCallback, useState } from 'react'

import { officeImageUrl } from './config.js'
import { useCallControls } from './useCallControls.js'
import { useKnocks } from './useKnocks.js'

/**
 * The office, full window.
 *
 * No header above it and no product identity anywhere: this app is the office and
 * nothing else. In unityofis the same map renders inside the app shell, which adds
 * the header and the switchers — and adds nothing to this package to do it.
 *
 * The strip beside the map is where the call tiles go, and which side depends on
 * the canvas shape: a landscape office has width to spare and height at a premium,
 * so the tiles go across the top; a square or portrait one is the other way round.
 * The space is reserved from the first paint, because a strip that appears when a
 * call starts would resize the map underneath somebody's cursor.
 */

export interface OfficePageProps {
  client: OfisClient
  template: Template
  onLeave(): void
}

export function OfficePage({ client, template, onLeave }: OfficePageProps) {
  const state = useOffice(client)
  const announce = useAnnounce()
  const { choice, setChoice } = useTheme()
  const [view, setView] = usePersisted<OfficeView>('ofiskit:view', 'map')
  const [pickingDevices, setPickingDevices] = useState(false)
  /**
   * The chosen microphone, camera and speaker, remembered.
   *
   * Per device rather than per person: somebody with a USB headset on their desk
   * should not pick it again every morning, and the headset is a property of the
   * desk rather than of them.
   */
  const [devices, setDevices] = usePersisted<DeviceChoice>('ofiskit:devices', {})

  const roomId = yourRoom(state)
  const room = template.rooms.find((one) => one.id === roomId)
  const reception = template.rooms.find((one) => one.type === 'reception')
  const tiles = tilePlacement(template.canvas)

  /**
   * Everything the bar does when it is pressed.
   *
   * Held here rather than in the bar, because pressing the microphone when you are
   * not in a call is a different act from pressing it when you are, and that rule
   * belongs in one place.
   */
  const call = useCallControls(client, state, {
    available: Boolean(room && hostsCalls(room.type)),
  })

  /*
   * This device's own signals, suspended while in a call.
   *
   * Somebody listening is not idle even though they have not touched anything for
   * twenty minutes, and the server would resolve them as away.
   */
  useIdleReporting(client, { enabled: !call.inCall })

  /**
   * A refusal is said out loud, not only drawn.
   *
   * The optimistic move has already snapped back by the time this runs, which is
   * visible to anybody watching the screen and invisible to everybody else.
   */
  useClientEvents(
    client,
    useCallback(
      (event) => {
        if (event.type === 'refused') announce(event.message, 'assertive')
        if (event.type === 'closed') announce(event.message, 'assertive')
      },
      [announce],
    ),
  )

  const join = useCallback(
    (id: string) => {
      const target = template.rooms.find((one) => one.id === id)
      void client.joinRoom(id).then((result) => {
        if (result.ok && target) announce(`You are in ${target.name}.`)
      })
    },
    [announce, client, template.rooms],
  )

  /**
   * The streams and the order the tiles draw from.
   *
   * Both come from the adapter's events and the office state, so the tiles never
   * know whether a mesh or an SFU is behind them.
   */
  const media = useCallMedia(client)
  const order = useSpeakerOrder(call.call?.participants ?? [], state.people)

  const knocks = useKnocks(client, template)

  const props = {
    template,
    state,
    imageUrl: officeImageUrl,
    onJoin: join,
    onKnock: knocks.knock,
    onLock: (id: string) => void client.lock(id),
    onUnlock: (id: string) => void client.unlock(id),
  }

  return (
    <div className="flex h-full flex-col">
      <div className={['flex min-h-0 flex-1', tiles === 'top' ? 'flex-col' : 'flex-row'].join(' ')}>
        {/*
          The tiles: a strip across the top of a landscape office, a column down
          the right of a square or portrait one. The canvas shape decides, because
          a landscape office has width to spare and height at a premium.

          Present only while there is a call, and absent rather than empty: an
          always-reserved strip is a permanent band of nothing at the top of the
          office, which is worse than the map resizing once when a call starts.
        */}
        {call.call && !call.callView && (
          <CallTiles
            call={call.call}
            people={state.people}
            order={order}
            media={media}
            you={state.you}
            placement={tiles}
            onMuteForMe={media.muteForMe}
            onVisibleChange={(deviceIds) => client.rtc.setVideoSubscriptions(deviceIds)}
          />
        )}

        {/*
          Positioned so the knock cards sit over the office rather than pushing it
          around: somebody arriving at the door must not move the room somebody
          else was about to click.
        */}
        <main className="relative min-h-0 min-w-0 flex-1">
          {/*
            Call view drops the map and gives the whole space to the call.

            The office is still there and still being kept up to date — this is a
            different view of the same state rather than a different place, which is
            why the toggle brings it back instantly and why a knock still arrives.
            The tiles themselves land with their own story; what is here is the
            space they fill.
          */}
          {call.callView && call.call ? (
            <div data-testid="call-view" className="h-full w-full">
              <CallTiles
                call={call.call}
                people={state.people}
                order={order}
                media={media}
                you={state.you}
                placement="grid"
                onMuteForMe={media.muteForMe}
                onVisibleChange={(deviceIds) => client.rtc.setVideoSubscriptions(deviceIds)}
              />
            </div>
          ) : view === 'map' ? (
            <OfficeMap {...props} />
          ) : (
            <RoomListView {...props} />
          )}

          <KnockDock knocks={knocks.incoming} onAdmit={knocks.admit} onDecline={knocks.decline} />

          {knocks.outgoing && (
            <div className="pointer-events-none absolute bottom-4 left-4 z-30 w-72">
              <OutgoingKnock
                roomName={knocks.outgoing.roomName}
                outcome={knocks.outgoing.outcome}
                message={knocks.outgoing.message ?? null}
                silent={knocks.outgoing.silent ?? false}
                onDismiss={knocks.dismiss}
              />
            </div>
          )}
        </main>
      </div>

      {/*
        The controls bar, and the only chrome in this app.
        
        The bar is always there; the *call* controls come and go, because reception
        and the break room never have calls. What surrounds them is everything about
        the office rather than about a call, in the slots the component leaves for a
        host — which is how the same bar sits inside unityofis's app shell.
      */}
      <CallControls
        available={call.available}
        inCall={call.inCall}
        muted={call.muted}
        cameraOn={call.cameraOn}
        sharing={call.sharing}
        callView={call.callView}
        call={call.call}
        onToggleMic={call.toggleMic}
        onToggleCamera={call.toggleCamera}
        onToggleShare={call.toggleShare}
        onToggleCallView={() => call.setCallView(!call.callView)}
        onLeaveCall={call.leaveCall}
        onOpenDevices={() => setPickingDevices(true)}
        leading={
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-sm">
              {room ? (
                <>
                  You are in <span className="font-medium">{room.name}</span>
                </>
              ) : (
                'Finding your desk…'
              )}
            </span>

            {room && reception && room.id !== reception.id && (
              <Button size="sm" variant="ghost" onClick={() => void client.leaveRoom()}>
                <Icon name="chevron-left" size="sm" /> Back to {reception.name}
              </Button>
            )}
          </div>
        }
        trailing={
          <div className="flex items-center gap-1">
            {/*
              In the bar, because this app has no header. unityofis puts the same
              component in the app shell's header and adds its org presets — which
              is the whole of the difference.
            */}
            <StatusControl
              you={yourPresence(state)}
              chosen={statusIsChosen(state)}
              fromBreakRoom={!statusIsChosen(state) && room?.type === 'break'}
              onSetStatus={(manual) => void client.setStatus(manual)}
              onSetCustom={(custom) => void client.setCustomStatus(custom)}
            />

            <ViewToggle view={view} onChange={setView} />

            {/*
              Theme is per person, so two people in the same room may be looking at
              different background images over identical geometry.
            */}
            <Select
              // Named for assistive technology without a visible label, because the
              // three options say what it is and a bar is not the place for a
              // heading over a control that is two words wide.
              aria-label="Theme"
              value={choice}
              onChange={(event) => setChoice(event.target.value as typeof choice)}
            >
              <option value="system">System theme</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>

            <Button size="sm" variant="ghost" onClick={onLeave}>
              <Icon name="log-out" size="sm" /> Leave
            </Button>
          </div>
        }
      />

      {/* The voices. A stream nothing is attached to is a stream nobody hears. */}
      <CallAudio
        client={client}
        mutedForMe={media.mutedForMe}
        {...(devices.speakerDeviceId ? { speakerDeviceId: devices.speakerDeviceId } : {})}
      />

      <DevicePanel
        open={pickingDevices}
        onClose={() => setPickingDevices(false)}
        choice={devices}
        onChoose={setDevices}
        onApply={(choice) => void client.rtc.useDevices(choice)}
        preview
      />
    </div>
  )
}
