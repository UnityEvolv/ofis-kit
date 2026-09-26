# @unityevolv/ofiskit-presence-store

## 0.1.1

### Patch Changes

- [#45](https://github.com/UnityEvolv/ofis-kit/pull/45) [`05ce390`](https://github.com/UnityEvolv/ofis-kit/commit/05ce3905681f950dd97b492634ec62a21c556d37) Thanks [@nvamsiram](https://github.com/nvamsiram)! - A host can set a status the engine cannot work out, such as being in a meeting on a calendar.

  - **`status.external` host event is now handled.** The engine stores the status on the person's presence and broadcasts it like any other status change. The person's own choice and being in a call still outrank it.
  - **An identity's `externalStatus` is applied on entry**, so somebody who arrives mid-meeting shows as in a meeting from the start.
  - **`quiet`**, on the event and as `externalQuiet` on the identity and the presence, makes the status silence interruptions the way do not disturb does. Without it a meeting is only a status.
