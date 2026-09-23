# @unityevolv/ofiskit-ui-builder

The office builder: three steps from nothing to a layout — a prompt for
generating the background picture, uploading it, and drawing the rooms on it.

```tsx
import { BuilderSteps } from '@unityevolv/ofiskit-ui-builder'

;<BuilderSteps document={promptDocument} saveLabel="Download template.json" onSave={save} />
```

It takes a layout and emits a layout, and does not know what the host will do
with it: the free app downloads `template.json`, and a product saves it to a
database. Rooms and user areas snap to a grid, stay inside their room, and are
validated as they are drawn, so a layout is caught while it is being made rather
than when somebody walks into a wall.

`darkVersion` makes the dark theme's picture from an SVG background, so two
pictures of one office cannot drift apart.

Peer dependencies: `react`, `react-dom` and `@unityevolv/unitykit`.

## Licence

AGPL-3.0-only. The interface packages (`ofiskit-template`,
`ofiskit-presence-store` and `ofiskit-adapters`) are Apache-2.0, so building
against the interfaces is not a licensing decision even though extending this is.

Part of [ofiskit](https://github.com/UnityEvolv/ofis-kit): a virtual office you
can run yourself. [Try the demo](https://unityevolv.com/ofis-kit/).
