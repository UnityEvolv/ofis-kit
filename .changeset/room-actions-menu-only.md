---
'@unityevolv/ofiskit-ui-map': minor
---

A host's action on a room can be kept to the room's menu: `menuOnly: true` on a `HostAction` leaves it out of the buttons on the room's bar. The map's bar then carries the menu's three-dots button, as the list's card always has, so the action is never behind a right-click alone. Actions without the flag are drawn as before.
