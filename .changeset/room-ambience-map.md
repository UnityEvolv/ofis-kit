---
'@unityevolv/ofiskit-ui-map': minor
---

Room ambience playback (UO-279). The engine plays a room's loop locally, never into a call, at the volume the host gives it; whether the person wants it is the host's to say.

- `useAmbience({ track, enabled, volume, suspended, speakerDeviceId? })` returns `{ status, track, start, duck }`. `enabled: false` is absolute. `suspended` (pass "in a call") fades it out and back. `status` is `silent | off | paused | blocked | loading | playing | unavailable`; `blocked` means the browser wants a press first, and `start()` from that press plays it for the rest of the session.
- `AmbienceControl` is the bar's indicator and quick control: shown whenever the room has a loop (even to somebody who has it off), the offer to start when the browser is waiting for a press, and the person's switch and volume in a popover. English by default; pass `labels` to translate.
- `createAmbiencePlayer()` is the Web Audio player behind it: seamless loops, each fetched once per session, 400 ms fades, and a duck under notifications.
- `useSounds` takes `onSound`, called as a knock or chime plays; pass `ambience.duck` so a knock is never buried.
