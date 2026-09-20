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

### Names and shapes on the wire

- **IDs are UUIDv7**: time-ordered, so they sort and index well, and opaque, so
  nothing is guessable. `newId()` in `realtime-core` is the only place they are
  made.
- **Timestamps are ISO 8601 in UTC with the zone explicit.** The server never
  formats a date for a person to read. The client formats, in the viewer's zone.
- **One error envelope**, for HTTP and for socket refusals alike: a stable
  machine `code`, a `message` safe to show, and an optional `fields` map for
  validation errors. Codes are documented and permanent; messages are for people
  and are never parsed.
- **Pagination is cursor-based** with a page size cap, never offset, so a list
  stays correct while rows arrive.
- **Every create accepts an idempotency key** and returns the same result for a
  retry with the same key. A retried network call must never make a second
  anything.
- **Versioning by URL prefix** (`/v1/...`). A breaking change is a new version,
  never a quiet one.
- **snake_case in JSON**, plural resource names, verbs only for actions that are
  not CRUD. Socket event names are `noun:verb` in lower case (`room:knock`).

### Dates and time zones

- Instants travel as ISO 8601 with the zone explicit and are compared in UTC.
  Retention and expiry checks never depend on anyone's zone.
- Date-only values stay dates, with the zone they are read in named alongside.
  Never midnight-in-some-zone standing in for a day.
- Time zones are IANA names (`Asia/Kolkata`), never offsets, so a schedule set in
  March still fires at the right hour in November.
- This repo has one zone that matters: the viewer's, taken from the browser. The
  org zone and the schedules that use it are the wrapper's.

### Hostnames and URLs

No hostname, origin or absolute product URL is ever a literal. Every one comes
from configuration derived from a single base hostname, and every link the
product emits is built by the one URL helper from that configuration. A default
belongs in the config module, which is the one place the lint rule is relaxed.

### Data

- Nothing here is persisted, so there is no soft delete to get wrong. In the
  wrapper: soft delete only where a record must stay referenceable, hard delete
  for everything transient.
- **No personal data in logs, ever.** User IDs are fine and are what you want
  when reading a log anyway. Display names, emails and photo URLs are not.
- Money is integer minor units with a currency code, never a float. Nothing here
  charges anyone; the rule is written down so the wrapper inherits it.

### Code

- **TypeScript strict**, in every package. `noUncheckedIndexedAccess` is on, so
  an array read is `T | undefined` and you handle it.
- **No `any` without a comment saying why.** `no-explicit-any` is an error, so
  the only way past it is a disable comment, which is the comment.
- `import type` for types, so the build erases them and a type import can never
  drag a runtime dependency along.
- Errors carry context and are never swallowed. Anything doing I/O takes a
  timeout or an abort signal.
- Tests live beside the code they test. A story is not done without them.
- Commits are conventional (`feat:`, `fix:`, `docs:`, `chore:`), so the changelog
  writes itself. A user-visible change to a published package needs a changeset:
  `npm run changeset`.
- Pull requests are small, name their story, and pass every check before review.

### Generated files

`app/public/icons/*`, `app/public/og.png` and `packages/*/dist` are generated.
Never hand-edit one. `npm run brand:check` fails if the icons have drifted from
the source SVG, and the build regenerates them.

## The design system

Everything visible is built from [unitykit](https://github.com/UnityEvolv/unity-kit):
buttons, avatars, icons, tokens, and the two themes. Three rules:

- **Icons come from the kit's `Icon`.** A direct `lucide-react` import fails
  lint: the kit fixes the size, the stroke and the accessible naming, and an
  icon imported around it is a different weight from every other icon.
- **No colour is ever hard-coded.** Every one comes from a token, which is what
  makes both themes follow from the token layer rather than a second stylesheet.
- **The kit's `Brand` component is not used here**, and this repository carries
  no mark, favicon or app icon. `npm run no-branding` fails if one appears. See
  [the boundary](docs/architecture.md).

Working against a local checkout of the kit:

```
cd ../unity-kit && npm run dev     # the kit, rebuilding on change
cd ofis-kit && npm link ../unity-kit
```

Unlink before committing — CI installs from the registry, with no local link
present, which is what proves a clean install works.

### The one thing that goes wrong

Tailwind does not scan `node_modules` when it looks for class names, so the
kit's classes generate **no CSS at all** unless `app/src/styles.css` points at
it with `@source`. There is no error and no warning: components render with
every class in the markup and none of the styles, and it looks like the kit is
broken.

The paths matter — npm hoists workspace packages to the repository root, not to
`app/node_modules`, and a path that looks right and resolves to nothing fails
exactly the same way as no path at all. `npm run kit:styles` checks the built
stylesheet for classes that can only come from that scan.

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
npm run kit:styles       # the kit’s CSS really was generated
npm run no-branding      # no logo, favicon or Brand has crept in
```

## Definition of done

Every story inherits [docs/definition-of-done.md](docs/definition-of-done.md)
rather than restating it. The short form: responsive with no horizontal scroll;
correct in **both** light and dark theme, every colour from a unitykit token;
loading, empty and error states handled; WCAG 2.1 AA, keyboard-operable, with
things that happen *to* you announced through a live region; and every control
the UI disables refused by the server independently, because the disabled state
is a convenience and never the control.
