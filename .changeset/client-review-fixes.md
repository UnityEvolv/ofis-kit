---
'@unityevolv/ofiskit-realtime-client': patch
---

Fixes from a client review.

- A client closed by the server, or by `close()`, stays `closed` instead of reporting `reconnecting` for ever, and stops the call's camera and microphone. `close()` now returns a promise that resolves once the media is released.
- The built-in mesh takes a remote camera or share off screen when it stops, rather than keeping its last frame: a track muted or removed from its stream counts, and turning a camera off is now announced to peers the way a stopped share already was. A stopped share is never promoted into the face tile.
- Switching microphone keeps a muted microphone muted, moves the speaking indicator to the new device, and keeps echo cancellation and noise suppression.
