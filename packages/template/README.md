# @unityevolv/ofiskit-template

The office layout: its schema, and the geometry that decides whether a layout is
usable.

A template is the rooms, where each sits on the background picture, where its bar
goes, and where people stand inside it. Every coordinate is a fraction of the
canvas, so one layout draws at any size. This package validates all of that, and
mints the ids the rest of ofiskit uses.

```ts
import { parseTemplate } from '@unityevolv/ofiskit-template'

const result = parseTemplate(await readFile('template.json', 'utf8'))
if (!result.ok) for (const issue of result.issues) console.error(issue.path, issue.message)
```

It is the lowest package here: everything else depends on it, and it depends on
nothing. No DOM and no Node APIs, so it runs in a browser, on a server and on a
phone.

## Licence

Apache-2.0. The interface packages are deliberately permissive, so that writing
an adapter against ofiskit is not a licensing decision.

Part of [ofiskit](https://github.com/UnityEvolv/ofis-kit): a virtual office you
can run yourself. [Try the demo](https://unityevolv.com/ofis-kit/).
