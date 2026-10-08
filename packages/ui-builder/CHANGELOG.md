# @unityevolv/ofiskit-ui-builder

## 0.3.0

### Minor Changes

- [#58](https://github.com/UnityEvolv/ofis-kit/pull/58) [`1ccd949`](https://github.com/UnityEvolv/ofis-kit/commit/1ccd949f646386f10d669418111a21933abef394) Thanks [@nvamsiram](https://github.com/nvamsiram)! - Ambience controls in the builder (UO-279). Pass `ambienceLibrary` (`AmbienceTrack[]`) to `OfficeBuilder` or `BuilderSteps` and the template panel offers an office ambience, and each room's panel a choice of following the office, none, or its own loop, with a preview so the author hears it before publishing. Meeting and conference rooms get a word of guidance, not a refusal. Without a library the controls are not offered and a template's existing choices are kept.

### Patch Changes

- Updated dependencies [[`31b3e18`](https://github.com/UnityEvolv/ofis-kit/commit/31b3e18dc7f9dc992e649b9825df66ca5dc17424)]:
  - @unityevolv/ofiskit-template@0.3.0

## 0.2.0

### Minor Changes

- [#50](https://github.com/UnityEvolv/ofis-kit/pull/50) [`913a648`](https://github.com/UnityEvolv/ofis-kit/commit/913a648d404ae2eca86892a735d356e22fa3ad35) Thanks [@nvamsiram](https://github.com/nvamsiram)! - A fourth room type that hosts calls, `conference`, for an all-hands or a town hall where a few present and most listen.

  - **`RoomType` gains `'conference'`**, and `ROOM_TYPES` lists it. It hosts a call (`hostsCalls('conference')` is true) and is not required: a new template is still seeded with reception, a break room and one workspace. `addRoom` can add one, and the validator accepts it.
  - **A conference room cannot be locked.** New `UNLOCKABLE_ROOM_TYPES` and `isLockable(type)` in the template package say so; the engine's `lock` asks `isLockable` and refuses with the existing `room.not_lockable`, and since a conference room is never locked, a knock on it gets the existing `knock.not_locked`. Who may speak in the room is left to the host's identity adapter and the provider's tokens; raising a hand is the existing `call:hand`.
  - **The room bar** offers no Lock in a conference room and marks it with the kit's `users` icon; the office map names it "conference room" to a screen reader.
  - **The builder's room inspector** offers Conference as a type, and a new room is numbered among every room that hosts a call.

### Patch Changes

- Updated dependencies [[`913a648`](https://github.com/UnityEvolv/ofis-kit/commit/913a648d404ae2eca86892a735d356e22fa3ad35)]:
  - @unityevolv/ofiskit-template@0.2.0
