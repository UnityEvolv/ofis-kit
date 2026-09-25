# @unityevolv/ofiskit-realtime-client

## 0.1.1

### Patch Changes

- [#41](https://github.com/UnityEvolv/ofis-kit/pull/41) [`e6bf057`](https://github.com/UnityEvolv/ofis-kit/commit/e6bf057c30457f53d7bacc5023fcbff50b082a16) Thanks [@nvamsiram](https://github.com/nvamsiram)! - Leaving a room's call by any route now ends it on this device too, and a device that left and came back connects again.

  - The client follows the call's participants in the office state. When this device's leg ends (moving room, leaving the office, the grace period, access revoked), the adapter leaves, so media stops flowing to a room the office says you left. When somebody else's leg ends, the adapter closes the connection to them.
  - The RTC adapter interface gains an optional `removeParticipant(deviceId)`.
  - The mesh adapter treats an offer from a new session as a new arrival, closing the old connection instead of failing silently on it. Joining while already joined starts clean, instead of registering a second signal listener.
