---
'@unityevolv/ofiskit-ui-map': patch
---

In the list view, reception and the break room keep their room-type icon on a narrow card. Their half-width cards fell under the compact width on a phone and lost the one mark that says which shared room a card is. `RoomBar` takes `keepTypeIcon` for this; a narrow room on the map still drops the icon, as before.
