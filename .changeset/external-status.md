---
'@unityevolv/ofiskit-presence-store': patch
'@unityevolv/ofiskit-adapters': patch
'@unityevolv/ofiskit-realtime-core': patch
---

A host can set a status the engine cannot work out, such as being in a meeting on a calendar.

- **`status.external` host event is now handled.** The engine stores the status on the person's presence and broadcasts it like any other status change. The person's own choice and being in a call still outrank it.
- **An identity's `externalStatus` is applied on entry**, so somebody who arrives mid-meeting shows as in a meeting from the start.
- **`quiet`**, on the event and as `externalQuiet` on the identity and the presence, makes the status silence interruptions the way do not disturb does. Without it a meeting is only a status.
