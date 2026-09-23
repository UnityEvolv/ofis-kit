# @unityevolv/ofiskit-ui-map

The office you can see: the map, the room bars, the avatars, the video tiles, the
call controls and the status control.

React DOM, built entirely from [unitykit](https://github.com/UnityEvolv/unity-kit):
every colour is a token, so both themes follow from the token layer, and every
icon comes from the kit at one weight.

```tsx
import { OfficeMap } from '@unityevolv/ofiskit-ui-map'

;<OfficeMap
  template={template}
  state={state}
  imageUrl={officeImageUrl}
  onJoin={client.joinRoom}
/>
```

It takes the office state and calls back; it never opens a socket itself. The
same components draw a template somebody downloaded from the free builder and one
a product stores in a database.

Peer dependencies: `react`, `react-dom` and `@unityevolv/unitykit`.

## Licence

AGPL-3.0-only. The interface packages (`ofiskit-template`,
`ofiskit-presence-store` and `ofiskit-adapters`) are Apache-2.0, so building
against the interfaces is not a licensing decision even though extending this is.

Part of [ofiskit](https://github.com/UnityEvolv/ofis-kit): a virtual office you
can run yourself. [Try the demo](https://unityevolv.com/ofis-kit/).
