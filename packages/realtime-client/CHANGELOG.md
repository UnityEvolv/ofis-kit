# @unityevolv/ofiskit-realtime-client

## 0.3.0

### Minor Changes

- [#58](https://github.com/UnityEvolv/ofis-kit/pull/58) [`8d85b13`](https://github.com/UnityEvolv/ofis-kit/commit/8d85b13f6eec1668abfc1a8ac18dcdabab5b51fa) Thanks [@nvamsiram](https://github.com/nvamsiram)! - `nudge`, `requestFollow`, `acceptFollow`, `declineFollow`, `stopFollowing` and `removeFollower` on the client, with `nudge` and `follow.*` events, `followOf(state)` for your own side of following, and `NUDGE_LINE_MAX` and `Refusal` re-exported. A `refused` event now carries the server's `fields`.

### Patch Changes

- Updated dependencies [[`f1e8196`](https://github.com/UnityEvolv/ofis-kit/commit/f1e8196a8cbb5f70a84ba05bd45e3ecba75c2ade), [`31b3e18`](https://github.com/UnityEvolv/ofis-kit/commit/31b3e18dc7f9dc992e649b9825df66ca5dc17424)]:
  - @unityevolv/ofiskit-realtime-core@0.4.0
  - @unityevolv/ofiskit-template@0.3.0

## 0.2.3

### Patch Changes

- [#56](https://github.com/UnityEvolv/ofis-kit/pull/56) [`249d980`](https://github.com/UnityEvolv/ofis-kit/commit/249d9805287542f71296e9067645a3ee4f540090) Thanks [@nvamsiram](https://github.com/nvamsiram)! - Fixes from a client review.

  - A client closed by the server, or by `close()`, stays `closed` instead of reporting `reconnecting` for ever, and stops the call's camera and microphone. `close()` now returns a promise that resolves once the media is released.
  - The built-in mesh takes a remote camera or share off screen when it stops, rather than keeping its last frame: a track muted or removed from its stream counts, and turning a camera off is now announced to peers the way a stopped share already was. A stopped share is never promoted into the face tile.
  - Switching microphone keeps a muted microphone muted, moves the speaking indicator to the new device, and keeps echo cancellation and noise suppression.

- Updated dependencies [[`249d980`](https://github.com/UnityEvolv/ofis-kit/commit/249d9805287542f71296e9067645a3ee4f540090)]:
  - @unityevolv/ofiskit-realtime-core@0.3.1

## 0.2.2

### Patch Changes

- Updated dependencies [[`65e9c9f`](https://github.com/UnityEvolv/ofis-kit/commit/65e9c9f63bca86630f3fbbf9486096e3f4fced9e)]:
  - @unityevolv/ofiskit-realtime-core@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`913a648`](https://github.com/UnityEvolv/ofis-kit/commit/913a648d404ae2eca86892a735d356e22fa3ad35)]:
  - @unityevolv/ofiskit-template@0.2.0
  - @unityevolv/ofiskit-realtime-core@0.2.0

## 0.2.0

### Minor Changes

- [#48](https://github.com/UnityEvolv/ofis-kit/pull/48) [`6f80abc`](https://github.com/UnityEvolv/ofis-kit/commit/6f80abca2692765015a373bea95c2f94d6c18718) Thanks [@nvamsiram](https://github.com/nvamsiram)! - The RTC adapter gets an optional data channel: `openDataChannel(label, options?)` returns a channel that sends short strings to one leg of the call or to all of them, and reports each message with the device it came from. The built-in mesh carries it on a negotiated channel per connection, with an id both ends derive from the label, so nothing renegotiates and legs that join later are included. Messages are capped at `DATA_CHANNEL_MAX_BYTES` (16 KiB). Other providers can add it later; a host checks for it before using it.

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
