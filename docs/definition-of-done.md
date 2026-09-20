# Definition of done

Agreed once, inherited by every story. A story does not restate these; it is not
done without them.

## Responsive

Works on a phone, a tablet and a desktop. No horizontal scrolling at any width.
Tap targets are usable with a thumb. Tables and lists degrade sensibly on a
narrow screen rather than overflowing.

The office map has its own version of this: a landscape office puts the call
tiles across the top, a square or portrait one puts them in a column on the
right, and on a narrow screen the map has a list view that carries the same
actions and the same realtime state.

## Both themes

Every screen is checked in light **and** dark before review. A screen that only
works in light mode is not done.

No colour is hard-coded. Every one comes from a unitykit token, so the two themes
follow from the token layer rather than from a second set of styles. Room bars,
avatars, status dots and the message row are kit components with theme-aware
surfaces; they are never drawn straight onto the background image, because an
image cannot be relied on for contrast.

The office background is per user, not per office: the template's dark image in
dark mode when it has one, the light image otherwise. Two people in the same room
may be looking at different images over identical geometry.

## States

Loading, empty and error states are handled and designed, not left to whatever
the component does with no data. An error says what happened and what to do next.

## Accessible, to WCAG 2.1 AA

The general rules:

- Everything reachable and operable by keyboard, with a visible focus ring and a
  sensible order.
- Every control and image labelled for a screen reader.
- Text and essential icons at AA contrast in both themes.
- Nothing conveyed by colour alone. Status has an icon or text as well as a dot.
- Motion respects `prefers-reduced-motion`, including avatar moves and reactions.
- Things that happen **to** you are announced through a live region, not only
  drawn: a knock, a mention, someone admitting you, a call starting.

The map is the hardest thing in the product to use without sight or a mouse, so
it carries more:

- The map is a landmark region and each room is a labelled group announcing, in
  this order: name, type, occupancy, lock state, and whether you can join.
- Rooms are in the tab order in reading order, arrow keys move between them, and
  Enter joins or knocks.
- People in a room are announced as a list with name and status. The overflow
  counter is a button that expands the rest.
- The list view is the accessible alternative to the map and is also simply
  useful on a small laptop.

Automated checks (axe or equivalent) run in CI on every page. A screen-reader
pass is part of review for anything interactive.

## Permission is enforced by the server

The UI hides or disables what a person cannot do. It never relies on hiding for
security.

Any control the UI disables or hides must also be refused by the server.
Re-enabling a button in devtools, replaying the request, or calling the endpoint
directly must fail the same way, with the same error code. **The disabled state is
a convenience, never the control.**

In this repo that means every refusal has two sides: the room bar says why the
join is disabled, and the core refuses `room:join` for the same reason even when
the client never showed the button.

## Tested

Unit tests for logic, component tests for anything with behaviour, and an
end-to-end test for a flow that a person actually performs. Tests live beside the
code they test. The call path is covered by the two-browser test on fake devices,
so the talking features are not verified by hand forever.
