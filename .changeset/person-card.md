---
'@unityevolv/ofiskit-ui-map': minor
---

The person's actions open as a hover card with their status, not a context menu.

- **A card on a person** wherever `personActions` gives them any, on the map and in the list alike: their photo or initials, their name, their status as the map draws it (the dot, the label, the custom status with its emoji, and "in a call" or "sharing their screen" where the presence says so), and the host's actions as buttons, a disabled one visible with its reason. It opens after a moment's hover, at once on keyboard focus (Tab walks into the buttons, Escape closes it and gives focus back), and on a tap; an avatar's `onClick` keeps precedence over the tap, and then a long press opens the card. One card at a time; the pointer leaving both the avatar and the card closes it after a short grace. It is a non-modal `dialog` named after the person, the avatar says `aria-haspopup="dialog"`, and nothing is announced: it is you looking at somebody, not something happening to you.
- **No menu on a person any more.** Right-click, a long press, ContextMenu and Shift+F10 on an avatar open nothing, the browser's own context menu is left alone, and the list view no longer draws a "More actions" button beside a person. A room keeps its menu, its bar's buttons and the list's button exactly as before. `OfficeMapProps.personActions` and `PersonAvatarProps.actions` keep their shape; they now fill the card.
