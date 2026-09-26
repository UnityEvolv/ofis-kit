# @unityevolv/ofiskit-adapters

## 0.1.2

### Patch Changes

- [#45](https://github.com/UnityEvolv/ofis-kit/pull/45) [`05ce390`](https://github.com/UnityEvolv/ofis-kit/commit/05ce3905681f950dd97b492634ec62a21c556d37) Thanks [@nvamsiram](https://github.com/nvamsiram)! - A host can set a status the engine cannot work out, such as being in a meeting on a calendar.

  - **`status.external` host event is now handled.** The engine stores the status on the person's presence and broadcasts it like any other status change. The person's own choice and being in a call still outrank it.
  - **An identity's `externalStatus` is applied on entry**, so somebody who arrives mid-meeting shows as in a meeting from the start.
  - **`quiet`**, on the event and as `externalQuiet` on the identity and the presence, makes the status silence interruptions the way do not disturb does. Without it a meeting is only a status.

- Updated dependencies [[`05ce390`](https://github.com/UnityEvolv/ofis-kit/commit/05ce3905681f950dd97b492634ec62a21c556d37)]:
  - @unityevolv/ofiskit-presence-store@0.1.1

## 0.1.1

### Patch Changes

- [#43](https://github.com/UnityEvolv/ofis-kit/pull/43) [`30dab19`](https://github.com/UnityEvolv/ofis-kit/commit/30dab1944e4d85bda867b25c6651daff17cc73fe) Thanks [@nvamsiram](https://github.com/nvamsiram)! - A host can tell a running office that something changed, and the office acts on it straight away instead of at the next action.

  - **`access.changed` host event.** The engine asks its identity adapter again, the same questions it asks at the door. A person no longer allowed in the office is disconnected; a person no longer allowed in their room is moved to reception. Either way they are told the host's reason. With no `userId`, everyone in the office is re-checked.
  - **`template.changed`** is now scoped to its office. It also moves anyone standing in a room the edit removed to the break room, ending that room's call leg by leg.
  - **New `office:notice` server event**, with a `room.removed` refusal code. The client passes it on as a `notice` event, so the person is told why they moved.
