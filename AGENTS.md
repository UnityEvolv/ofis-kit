# Working in ofiskit

The conventions for this repository, for a human and for an agent alike. They are
here because a decision made once and written down is cheaper than the same
decision made differently in twelve places. Where a linter can enforce a rule it
does, and CI fails; where it cannot, the pull request template asks.

unityofis carries the same document with the wrapper-only parts (organisation
scoping, provenance columns, the Go services) added back. A contributor from
outside gets the same rules as an employee. That is the point of writing them
down.

## What this repository is

ofiskit is the office itself: one Node process holding presence, and one web app
drawing it. unityofis is a wrapper around this engine, and the line between them
is the whole architecture:

- **Every permission question is an adapter call.** Never a query into
  organizations, memberships or roles, because those do not exist here. The core
  asks its `IdentityAdapter` whether this person may enter the office, join this
  room, lock it, or invite. This app's adapter takes a typed email and says yes;
  unityofis answers from memberships, roles, restriction and plan limits.
- **Every layout read goes through the template source.** A file here, a
  database there.
- **Everywhere presence is stored is the presence store.** Memory here, Redis
  there.
- **Every RTC provider implements the provider interface**, both halves: a server
  plugin and a client adapter. The built-in peer-to-peer provider is the
  reference implementation and the only one here.

If a change makes the core ask a question it cannot ask through an adapter, the
change is in the wrong place. Add to the interface, or put the code in the host.

## What this repository does not have

No accounts, no verification, no admin, no roles, no chat, no database, no job
scheduler, no job queue. Restart the server and everyone reconnects to an empty
office. This is not a gap to be filled in; it is what makes the boundary
provable. Features needing any of it belong in unityofis.

There is deliberately no scheduler anywhere. Anything connection-scoped (knock
expiry, presence timeout) is an in-memory timer on the socket. Anything else is
checked at the moment of use: a custom status with an expiry disappears because a
reader compares two instants, not because something swept it.

## Layout

```
packages/       what a wrapper imports, published as @unityevolv/ofiskit-*
  template/          layout schema and geometry validator          Apache-2.0
  presence-store/    the interface, plus the in-memory store        Apache-2.0
  adapters/          identity, template source, event bus, limiter  Apache-2.0
  realtime-core/     presence, moves, status, lock, signalling      AGPL-3.0
  realtime-client/   office state on the client, RTC adapters       AGPL-3.0
  ui-map/            the map, bars, tiles, controls (React DOM)     AGPL-3.0
  ui-builder/        the office builder (React DOM)                 AGPL-3.0
server/         this app's host: the core wired to the built-ins
app/            the single-office web app, and the builder as a page
config/         template.json and the background image, which is the office
deploy/         docker compose: server, app, coturn
tools/          the repo's own lint rules and its bundle budget
docs/           the process, the definition of done, the background prompt
brand/          the mark, and the script that generates every icon from it
```

The interface packages are Apache-2.0 so nobody is discouraged from building
against them. Everything else is AGPL-3.0-only. A package's `license` field is
the authority; keep it accurate when adding one.

`packages/*` is platform-agnostic, and a React Native app will import it, with
two exceptions: `ui-map` and `ui-builder` are React DOM and exist to hold the
web-only half. `ofiskit/no-dom-in-agnostic` enforces this. `navigator` and
`RTCPeerConnection` are allowed, because React Native shims both; `document`,
`window` and `localStorage` are not.

## Rules with a check behind them

Each of these fails CI, and each has a test in
`tools/eslint-plugin-ofiskit/rules.test.js` proving that it fails. A rule nobody
has seen fail is indistinguishable from one that is not wired up.

| Rule | Why |
| --- | --- |
| `ofiskit/no-dom-in-agnostic` | A `document` in the realtime client is a crash on a phone, not a type error in CI. |
| `ofiskit/no-hostname-literal` | The product has to change domain by changing one variable, and the demo has to run on a stranger's box. |
| `ofiskit/no-provider-sdk-outside-adapter` | A UI component importing an SDK makes every app ship it, and swapping providers stops being configuration. |
| `ofiskit/no-lucide-direct` | The kit's `Icon` fixes size, stroke and accessible naming; an icon around it is a different weight from every other icon. |
| `ofiskit/no-pii-in-logs` | Logs are shipped, retained and searched by people who were never granted access to the office. |

Plus a bundle-size budget per entry point (`npm run budget`), so a careless
import cannot quietly double the app.

## Conventions

The decisions every part of this repository would otherwise make differently —
ids, timestamps, the error envelope, dates and time zones, hostnames, logging
and the code style — are made once and written down here by UO-166.

### Generated files

`app/public/icons/*`, `app/public/og.png` and `packages/*/dist` are generated.
Never hand-edit one. `npm run brand:check` fails if the icons have drifted from
the source SVG, and the build regenerates them.

## Commands

```
npm install              # once
npm run dev              # server and app together, watching
npm test                 # unit and component tests, both projects
npm run test:e2e         # the two-browser call test, on fake devices
npm run lint             # every rule above
npm run typecheck        # every package
npm run build            # packages, then the app
npm run budget           # bundle size against the budget
```

## Definition of done

Every story inherits [docs/definition-of-done.md](docs/definition-of-done.md)
rather than restating it. The short form: responsive with no horizontal scroll;
correct in **both** light and dark theme, every colour from a unitykit token;
loading, empty and error states handled; WCAG 2.1 AA, keyboard-operable, with
things that happen *to* you announced through a live region; and every control
the UI disables refused by the server independently, because the disabled state
is a convenience and never the control.
