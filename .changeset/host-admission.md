---
'@unityevolv/ofiskit-realtime-core': minor
'@unityevolv/ofiskit-adapters': minor
---

A host can let one person into one locked room, once, for a reason of its own.

- **`admitUser(officeId, roomId, userId)` on `OfficeEngine`**: records the same one-shot admission that answering a knock does, with no knock — honoured by that person's next `joinRoom` into that room, spent by the move it authorises, standing for nobody else and no other room, and unlocking nothing. The engine is not told why; nothing is sent to the person. The hook for a host-side invitation, such as an occupant inviting somebody through a feature the engine has never heard of.
- **`admission.granted` on the host event bus** (`AdmissionGranted` in the adapters package): published by `admitUser` and recorded by every node serving that office, so an admission recorded on one node is honoured on whichever node the person's socket is on. Without a bus, it stands on the one node.
