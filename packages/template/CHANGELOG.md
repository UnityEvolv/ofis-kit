# @unityevolv/ofiskit-template

## 0.2.0

### Minor Changes

- [#50](https://github.com/UnityEvolv/ofis-kit/pull/50) [`913a648`](https://github.com/UnityEvolv/ofis-kit/commit/913a648d404ae2eca86892a735d356e22fa3ad35) Thanks [@nvamsiram](https://github.com/nvamsiram)! - A fourth room type that hosts calls, `conference`, for an all-hands or a town hall where a few present and most listen.

  - **`RoomType` gains `'conference'`**, and `ROOM_TYPES` lists it. It hosts a call (`hostsCalls('conference')` is true) and is not required: a new template is still seeded with reception, a break room and one workspace. `addRoom` can add one, and the validator accepts it.
  - **A conference room cannot be locked.** New `UNLOCKABLE_ROOM_TYPES` and `isLockable(type)` in the template package say so; the engine's `lock` asks `isLockable` and refuses with the existing `room.not_lockable`, and since a conference room is never locked, a knock on it gets the existing `knock.not_locked`. Who may speak in the room is left to the host's identity adapter and the provider's tokens; raising a hand is the existing `call:hand`.
  - **The room bar** offers no Lock in a conference room and marks it with the kit's `users` icon; the office map names it "conference room" to a screen reader.
  - **The builder's room inspector** offers Conference as a type, and a new room is numbered among every room that hosts a call.
