---
'@unityevolv/ofiskit-realtime-client': minor
---

The RTC adapter gets an optional data channel: `openDataChannel(label, options?)` returns a channel that sends short strings to one leg of the call or to all of them, and reports each message with the device it came from. The built-in mesh carries it on a negotiated channel per connection, with an id both ends derive from the label, so nothing renegotiates and legs that join later are included. Messages are capped at `DATA_CHANNEL_MAX_BYTES` (16 KiB). Other providers can add it later; a host checks for it before using it.
