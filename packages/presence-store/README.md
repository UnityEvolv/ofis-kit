# @unityevolv/ofiskit-presence-store

Who is in which room, and for how long: the presence store interface, and an
in-memory implementation of it.

Presence is per person rather than per connection, because somebody may have a
laptop and a phone open and is still one person standing in one room. Each entry
carries a time to live, so a browser that vanishes without saying goodbye does
not leave a ghost in a room.

```ts
import { MemoryPresenceStore } from '@unityevolv/ofiskit-presence-store'

const store = new MemoryPresenceStore()
await store.list('office')
```

The in-memory store is the whole answer for one process. Implement the same
interface over Redis and the same engine runs across many nodes, which is the
only difference between the free office and a clustered one.

## Licence

Apache-2.0. The interface packages are deliberately permissive, so that writing
an adapter against ofiskit is not a licensing decision.

Part of [ofiskit](https://github.com/UnityEvolv/ofis-kit): a virtual office you
can run yourself. [Try the demo](https://unityevolv.com/ofis-kit/).
