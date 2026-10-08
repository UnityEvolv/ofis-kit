---
'@unityevolv/ofiskit-template': minor
---

Room ambience in the template format (UO-279).

- `Template.ambience?: string` is the office default background loop, by library id; absent means silence.
- `Room.ambience?: string` overrides it: a library id, `"none"` for silence whatever the default says, or absent to inherit.
- `validateTemplate` keeps both and refuses a malformed one with the new `template.ambience_invalid` code (path `ambience` or `rooms[n].ambience`). Ids are lower-case words joined by hyphens, at most 40 characters; whether an id exists is the host's library to say.
- New helpers: `roomAmbience(template, room)` resolves what a room plays (an id or `null`), `roomTrack(template, room, library)` finds it in a host's library, `isAmbienceId`, `AMBIENCE_NONE` and the `AmbienceTrack` type (`{ id, label, src }`).
