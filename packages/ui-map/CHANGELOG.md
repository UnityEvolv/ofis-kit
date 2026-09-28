# @unityevolv/ofiskit-ui-map

## 0.3.0

### Minor Changes

- [#50](https://github.com/UnityEvolv/ofis-kit/pull/50) [`913a648`](https://github.com/UnityEvolv/ofis-kit/commit/913a648d404ae2eca86892a735d356e22fa3ad35) Thanks [@nvamsiram](https://github.com/nvamsiram)! - A fourth room type that hosts calls, `conference`, for an all-hands or a town hall where a few present and most listen.

  - **`RoomType` gains `'conference'`**, and `ROOM_TYPES` lists it. It hosts a call (`hostsCalls('conference')` is true) and is not required: a new template is still seeded with reception, a break room and one workspace. `addRoom` can add one, and the validator accepts it.
  - **A conference room cannot be locked.** New `UNLOCKABLE_ROOM_TYPES` and `isLockable(type)` in the template package say so; the engine's `lock` asks `isLockable` and refuses with the existing `room.not_lockable`, and since a conference room is never locked, a knock on it gets the existing `knock.not_locked`. Who may speak in the room is left to the host's identity adapter and the provider's tokens; raising a hand is the existing `call:hand`.
  - **The room bar** offers no Lock in a conference room and marks it with the kit's `users` icon; the office map names it "conference room" to a screen reader.
  - **The builder's room inspector** offers Conference as a type, and a new room is numbered among every room that hosts a call.

### Patch Changes

- Updated dependencies [[`913a648`](https://github.com/UnityEvolv/ofis-kit/commit/913a648d404ae2eca86892a735d356e22fa3ad35)]:
  - @unityevolv/ofiskit-template@0.2.0
  - @unityevolv/ofiskit-realtime-client@0.2.1

## 0.2.0

### Minor Changes

- [#47](https://github.com/UnityEvolv/ofis-kit/pull/47) [`e1f1bf6`](https://github.com/UnityEvolv/ofis-kit/commit/e1f1bf619493ddbcc22095a8db70ec6ff88ae606) Thanks [@nvamsiram](https://github.com/nvamsiram)! - The map takes a `decoration`: a transparent picture drawn over the office’s edges, beneath rooms and avatars, that ignores the pointer. For festival frames and the like; the host chooses which and when.

### Patch Changes

- Updated dependencies [[`6f80abc`](https://github.com/UnityEvolv/ofis-kit/commit/6f80abca2692765015a373bea95c2f94d6c18718)]:
  - @unityevolv/ofiskit-realtime-client@0.2.0

## 0.1.3

### Patch Changes

- [#45](https://github.com/UnityEvolv/ofis-kit/pull/45) [`21f4178`](https://github.com/UnityEvolv/ofis-kit/commit/21f417835516f266d428f87452054d9b4715fc3e) Thanks [@nvamsiram](https://github.com/nvamsiram)! - A host can add a line under a room's bar, such as a meeting booked in the room soon.

  - **`notice` on `RoomBar`**, and **`noticeOf(room)`** on `OfficeMap` and `RoomListView`. It shows in the bar's message row only when nothing more urgent does: a reason you cannot go in, or a full call, comes first. The free office passes none.

- Updated dependencies [[`05ce390`](https://github.com/UnityEvolv/ofis-kit/commit/05ce3905681f950dd97b492634ec62a21c556d37)]:
  - @unityevolv/ofiskit-presence-store@0.1.1
  - @unityevolv/ofiskit-realtime-client@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [[`30dab19`](https://github.com/UnityEvolv/ofis-kit/commit/30dab1944e4d85bda867b25c6651daff17cc73fe)]:
  - @unityevolv/ofiskit-realtime-client@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`e6bf057`](https://github.com/UnityEvolv/ofis-kit/commit/e6bf057c30457f53d7bacc5023fcbff50b082a16)]:
  - @unityevolv/ofiskit-realtime-client@0.1.1
