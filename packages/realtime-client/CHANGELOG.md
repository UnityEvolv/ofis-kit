# @unityevolv/ofiskit-realtime-client

## 0.1.3

### Patch Changes

- Updated dependencies [[`05ce390`](https://github.com/UnityEvolv/ofis-kit/commit/05ce3905681f950dd97b492634ec62a21c556d37)]:
  - @unityevolv/ofiskit-presence-store@0.1.1
  - @unityevolv/ofiskit-realtime-core@0.1.2

## 0.1.2

### Patch Changes

- [#43](https://github.com/UnityEvolv/ofis-kit/pull/43) [`30dab19`](https://github.com/UnityEvolv/ofis-kit/commit/30dab1944e4d85bda867b25c6651daff17cc73fe) Thanks [@nvamsiram](https://github.com/nvamsiram)! - A host can tell a running office that something changed, and the office acts on it straight away instead of at the next action.

  - **`access.changed` host event.** The engine asks its identity adapter again, the same questions it asks at the door. A person no longer allowed in the office is disconnected; a person no longer allowed in their room is moved to reception. Either way they are told the host's reason. With no `userId`, everyone in the office is re-checked.
  - **`template.changed`** is now scoped to its office. It also moves anyone standing in a room the edit removed to the break room, ending that room's call leg by leg.
  - **New `office:notice` server event**, with a `room.removed` refusal code. The client passes it on as a `notice` event, so the person is told why they moved.

- Updated dependencies [[`30dab19`](https://github.com/UnityEvolv/ofis-kit/commit/30dab1944e4d85bda867b25c6651daff17cc73fe)]:
  - @unityevolv/ofiskit-realtime-core@0.1.1

## 0.1.1

### Patch Changes

- [#41](https://github.com/UnityEvolv/ofis-kit/pull/41) [`e6bf057`](https://github.com/UnityEvolv/ofis-kit/commit/e6bf057c30457f53d7bacc5023fcbff50b082a16) Thanks [@nvamsiram](https://github.com/nvamsiram)! - Leaving a room's call by any route now ends it on this device too, and a device that left and came back connects again.

  - The client follows the call's participants in the office state. When this device's leg ends (moving room, leaving the office, the grace period, access revoked), the adapter leaves, so media stops flowing to a room the office says you left. When somebody else's leg ends, the adapter closes the connection to them.
  - The RTC adapter interface gains an optional `removeParticipant(deviceId)`.
  - The mesh adapter treats an offer from a new session as a new arrival, closing the old connection instead of failing silently on it. Joining while already joined starts clean, instead of registering a second signal listener.
