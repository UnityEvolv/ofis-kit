# @unityevolv/ofiskit-adapters

The questions the office asks its host, and the answers the free office gives.

Everything ofiskit cannot work out for itself arrives through one of these
interfaces, and never through a query into somebody's database:

- **`IdentityAdapter`** — who is this, and may they enter, join a room, lock it,
  knock or call? The built-in one takes a typed email and says yes to everything.
- **`TemplateSource`** — where the layout comes from: a file here, a database
  there.
- **`EventBus`** and **`RateLimiter`** — what the host wants to hear about, and
  what it will put up with.

```ts
import { typedEmailIdentity, memoryRateLimiter, fileTemplateSource } from '@unityevolv/ofiskit-adapters'
import { staticTemplateSource } from '@unityevolv/ofiskit-adapters/portable'
```

The `./portable` entry point leaves out the one template source that needs a file
system, so a browser or a React Native app can import the rest.

## Licence

Apache-2.0. The interface packages are deliberately permissive, so that writing
an adapter against ofiskit is not a licensing decision.

Part of [ofiskit](https://github.com/UnityEvolv/ofis-kit): a virtual office you
can run yourself. [Try the demo](https://unityevolv.com/ofis-kit/).
