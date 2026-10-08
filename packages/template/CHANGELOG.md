# @unityevolv/ofiskit-template

## 0.3.0

### Minor Changes

- [#58](https://github.com/UnityEvolv/ofis-kit/pull/58) [`31b3e18`](https://github.com/UnityEvolv/ofis-kit/commit/31b3e18dc7f9dc992e649b9825df66ca5dc17424) Thanks [@nvamsiram](https://github.com/nvamsiram)! - Room ambience in the template format (UO-279).

  - `Template.ambience?: string` is the office default background loop, by library id; absent means silence.
  - `Room.ambience?: string` overrides it: a library id, `"none"` for silence whatever the default says, or absent to inherit.
  - `validateTemplate` keeps both and refuses a malformed one with the new `template.ambience_invalid` code (path `ambience` or `rooms[n].ambience`). Ids are lower-case words joined by hyphens, at most 40 characters; whether an id exists is the host's library to say.
  - New helpers: `roomAmbience(template, room)` resolves what a room plays (an id or `null`), `roomTrack(template, room, library)` finds it in a host's library, `isAmbienceId`, `AMBIENCE_NONE` and the `AmbienceTrack` type (`{ id, label, src }`).

## 0.2.0

### Minor Changes

- [#50](https://github.com/UnityEvolv/ofis-kit/pull/50) [`913a648`](https://github.com/UnityEvolv/ofis-kit/commit/913a648d404ae2eca86892a735d356e22fa3ad35) Thanks [@nvamsiram](https://github.com/nvamsiram)! - A fourth room type that hosts calls, `conference`, for an all-hands or a town hall where a few present and most listen.

  - **`RoomType` gains `'conference'`**, and `ROOM_TYPES` lists it. It hosts a call (`hostsCalls('conference')` is true) and is not required: a new template is still seeded with reception, a break room and one workspace. `addRoom` can add one, and the validator accepts it.
  - **A conference room cannot be locked.** New `UNLOCKABLE_ROOM_TYPES` and `isLockable(type)` in the template package say so; the engine's `lock` asks `isLockable` and refuses with the existing `room.not_lockable`, and since a conference room is never locked, a knock on it gets the existing `knock.not_locked`. Who may speak in the room is left to the host's identity adapter and the provider's tokens; raising a hand is the existing `call:hand`.
  - **The room bar** offers no Lock in a conference room and marks it with the kit's `users` icon; the office map names it "conference room" to a screen reader.
  - **The builder's room inspector** offers Conference as a type, and a new room is numbered among every room that hosts a call.
