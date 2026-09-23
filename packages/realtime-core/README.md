# @unityevolv/ofiskit-realtime-core

The office engine: presence, moves, status, lock and knock, calls and WebRTC
signalling, over one socket.

Every rule lives here, and none of them knows what it is running on. The engine
talks to a `Transport`, asks its adapters every permission question, and sends
snapshots and diffs with a sequence number, so a client that misses one knows to
ask for a fresh snapshot.

```ts
import { createRealtimeServer } from '@unityevolv/ofiskit-realtime-core'

const realtime = createRealtimeServer({
  httpServer,
  officeId,
  store,
  identity,
  templates,
  limiter,
  provider,
})
```

Two entry points:

- **`.`** — the above, plus the Socket.IO server and the TURN credentials, which
  need Node.
- **`./portable`** — the engine, the provider interface and the protocol, with no
  Socket.IO and no `node:crypto`, for a host that is not a Node process. The
  demo uses it to run the whole office inside a browser tab.

Calls go through an `RtcServerPlugin`. The built-in one is peer-to-peer and has
no media server at all; swapping in another provider is a plugin here and an
adapter on the client, and no change to any rule above them.

## Licence

AGPL-3.0-only. The interface packages (`ofiskit-template`,
`ofiskit-presence-store` and `ofiskit-adapters`) are Apache-2.0, so building
against the interfaces is not a licensing decision even though extending this is.

Part of [ofiskit](https://github.com/UnityEvolv/ofis-kit): a virtual office you
can run yourself. [Try the demo](https://unityevolv.com/ofis-kit/).
