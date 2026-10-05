---
'@unityevolv/ofiskit-ui-map': minor
---

A host can put its own actions on a person and on a room — message them, pin them, reserve it — and the engine offers them without knowing what any of them does.

- **`HostAction`**: `{ id, label, disabled?, onSelect() }`, where `disabled` is the reason it cannot be used right now, shown as the item's hint and read as its description.
- **`personActions(person, roomId)`** and **`roomActions(room)`** on `OfficeMap` and `RoomListView`. On the map, a right-click, a long press on touch (about half a second, cancelled by movement) or the ContextMenu key and Shift+F10 on an avatar or a room open a menu of them, anchored to the avatar or the room; an avatar's `onClick` keeps doing what it did. In the list every person and every room gets a visible "More actions" button that opens the same menu, with the same keys on the row, so the list offers everything the map does. The menu is the kit's: `menu` of `menuitem`s, arrow keys, Home and End, Escape and click outside to close, focus back to what opened it, and its opening said through the `Announcer`. None, or an empty list, and nothing opens and the browser's own context menu is left alone. The free office passes none.
- **`actions` on `RoomBar`** draws them as secondary buttons after the bar's own controls, a disabled one visible with its reason in the message row like Join; `OfficeMap` and `RoomListView` pass `roomActions(room)` into every bar. Not on a narrow bar, where Join is the one thing that must fit; the room's menu carries them at every width.
- **`actions` on `PersonAvatar`**, for a host drawing avatars itself.
