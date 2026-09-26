# @unityevolv/ofiskit-realtime-client

The office as a client sees it: connect, walk in, move between rooms, and take
part in the call.

It holds the office state, applies diffs, notices a gap in the sequence and
resyncs, and reconnects without the person having to do anything. It carries no
DOM, so React Native can use it as it is.

```ts
import { createOfisClient } from '@unityevolv/ofiskit-realtime-client'

const client = createOfisClient({ url, deviceId })
client.subscribe((office) => render(office))

await client.enter({ email, name })
await client.joinRoom(roomId)
await client.joinCall({ audio: true, video: false })
```

The RTC half is an adapter too. The built-in one is a peer-to-peer mesh with
audio, video and screen share; another provider's SDK goes behind the same
interface, and the UI never learns which is in use.

An adapter may also carry small messages between the legs of a call. It is
optional, so check for it:

```ts
const channel = client.rtc.openDataChannel?.('input', { ordered: false, maxRetransmits: 0 })
if (channel) {
  const stop = channel.onMessage((data, fromDeviceId) => handle(data, fromDeviceId))
  channel.send(JSON.stringify(event)) // everyone in the call
  channel.send(JSON.stringify(event), deviceId) // one leg
}
```

Both ends open the same label. Strings only, at most `DATA_CHANNEL_MAX_BYTES`
(16 KiB) each; a leg not connected yet is skipped, and the channel closes when
the call ends. The built-in mesh carries it on a negotiated data channel per
connection, with an id both ends derive from the label.

`connect` takes any socket-like object, so the client can run over something
other than Socket.IO — which is how the browser-only demo puts the whole office
in a tab.

## Licence

AGPL-3.0-only. The interface packages (`ofiskit-template`,
`ofiskit-presence-store` and `ofiskit-adapters`) are Apache-2.0, so building
against the interfaces is not a licensing decision even though extending this is.

Part of [ofiskit](https://github.com/UnityEvolv/ofis-kit): a virtual office you
can run yourself. [Try the demo](https://unityevolv.com/ofis-kit/).
