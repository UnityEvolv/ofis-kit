---
'@unityevolv/ofiskit-template': minor
---

Read an office out of a structured SVG. `readOfficeSvg` detects `room-<type>-<Name>` groups and `area-<cols>x<rows>` markers, checks the file against an element allow-list (no scripts, embedded documents, raster images, outside links, lettering or animation) and returns a prefilled template with every problem listed by room and line. A file without the markers is a plain picture, as before. The convention is documented in `docs/office-svg/spec.md`, with worked examples that double as test fixtures and generated AI prompts per theme.
