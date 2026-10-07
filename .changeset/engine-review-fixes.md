---
'@unityevolv/ofiskit-realtime-core': patch
---

Fixes from an engine review.

- A device id now belongs to one person. `enter` refuses an id somebody else is using (on an open socket, in a call leg including one held through a reconnect, or on a presence record) with the new refusal `device.in_use`, and signalling and share notices only ever go to the leg owner's newest socket.
- A socket that dies after its device has already reconnected no longer ends that device's call or starts a grace period.
- When one of somebody's devices drops while another remains, whether they are still in a call is recomputed, so they stop being shown in a call indefinitely.
- An empty `allowedOrigins` now means same-origin only, as documented: the origin is checked on every request including the WebSocket upgrade, which CORS never covered.
- A pending `person.updated` is no longer lost when a `person.moved` for the same person arrives in the same diff window.
- `unlock` ends the knocks waiting on the door and tells the knockers and the room.
- Admissions expire after a minute unused, and are dropped when their person leaves the office.
- New `maxPresent` option: a newcomer is refused with `office.full` once the office holds that many people.
- `SignalMessage` gains the `camera` type the built-in mesh uses to say a camera stopped.
