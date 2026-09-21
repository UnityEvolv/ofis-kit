# The engine boundary

The office is open source. unityofis is a wrapper around it. This document draws
the line, and the free app in this repository is what proves the line is real.

## Why a boundary at all

The pitch is no lock-in, and a free office anyone can run is the strongest form
of it. A team tries this office in an afternoon; when they want a second office,
guests, or LiveKit, that is unityofis. It is the funnel and the proof at once.

A boundary that is only documented drifts. This one is enforced two ways: the
wrapper imports the published packages and never forks them, and the engine
cannot answer a permission question by itself even if someone wanted it to,
because there is nothing here to query.

## The engine has no identity of its own

The free app is one office and nothing else. No header, no navigation, no
branding, no product name: the map fills the window and the controls bar sits at
the bottom, carrying the status control, the view toggles and the way out —
everything a header would otherwise have held.

This is a boundary rule, not a styling preference. A team self-hosting the
engine is running their office, not our product, and a wrapper that wants a
header adds its own. So the engine repository carries no logo, no favicon, no
app icons, no open-graph image and no `Brand` component; whoever hosts it
decides what, if anything, goes in the browser tab. unitykit is still the
design system underneath — buttons, avatars, icons, tokens — because that is
shared furniture rather than identity.

The practical test: if a screenshot of the running app tells you whose product
it is, something has crossed the line.

## The three interfaces

Everything the office needs from its host arrives through one of three
interfaces. They are Apache-2.0, separately from the AGPL engine, so that
building against them is not a licensing decision.

### Identity adapter

Given a connection, who is this (id, display name, photo), and may they do this?
The questions are fixed: enter this office, join this room, lock a room, invite
someone, knock.

- **This app**: takes a typed email and a name, and answers yes to everything.
  The email is who you are and nothing checks it.
- **unityofis**: validates a session token and answers from memberships, roles,
  restriction, guest grants and plan limits.

The core never queries memberships. It asks. That single rule is what lets the
same `room:join` handler refuse a restricted room in unityofis and allow it here
with no code difference between them.

### Template source

Where the office layout comes from.

- **This app**: reads `config/template.json` from disk.
- **unityofis**: reads its database, with the platform catalog behind it.

The schema is the same object in both, published as
`@unityevolv/ofiskit-template`, so a template built in the free builder imports
into unityofis unchanged.

### Presence store

Where who-is-where lives.

- **This app**: memory, one process. Restart it and the office is empty, which is
  honest for something that persists nothing.
- **unityofis**: Redis, many nodes, with a TTL backstop so a node dying
  mid-timer expires presence rather than leaving ghosts.

## And the RTC provider interface

A fourth interface, with two halves that must both exist for a provider to be
usable: a **server plugin** (create and end a call, issue credentials, report
joins and speaking, declare limits, cost model and origins) and a **client
adapter** (join, publish tracks, choose who to subscribe to, emit events in one
shape).

The built-in peer-to-peer provider is the reference implementation and the only
one here. It declares four participants, audio, video and screen share, and no
server-side recording. unityofis adds the rest.

The controls bar, the tiles and the indicators consume the adapter's events and
never import a provider SDK. `ofiskit/no-provider-sdk-outside-adapter` is the
check; the reason is that a UI component asking an SDK a question makes every app
ship that SDK, and swapping providers stops being configuration.

Sharing a screen adds one small seam beside it, for the platform rather than the
provider: **where the list of shareable screens and windows comes from**. On the
web there is nothing to supply, because `getDisplayMedia` opens the browser's own
picker — the one people already know, and the only one that can offer a single tab.
A desktop shell has no such dialog, so it supplies the list and the shared picker
draws it, leaving out its own window because sharing the window that is doing the
sharing is an infinite mirror. Nothing in the packages imports Electron or knows it
exists; they take a provider or they take none.

One share at a time is not the picker's rule but the call's: the call holds a single
share slot, so a second share takes it and the displaced client is told on its own
socket to stop capturing. A field that can hold one value is a stronger guarantee
than the same rule written across every participant's flags.

## Two more hooks

Smaller, and unbound here on purpose:

- **Event bus**: things the host wants to push into the core, such as a
  revocation that must disconnect a live socket. This app has no publisher;
  unityofis binds it to a Redis pub/sub bridge, so identity can end someone's
  access without a message broker in between.
- **Rate limiter**: the core rate-limits knocks with a limiter the host supplies.
  A counter in a Map here, the shared primitive there.

Plus report hooks for relayed bytes, connection quality and call records, which
this app logs and unityofis attributes to an organization.

## Where each repository sits

Three repositories. Phase one builds the first.

**ofiskit**, public, AGPL with Apache-2.0 interfaces. The layout is in
[AGENTS.md](../AGENTS.md).

**unityofis-backend**, private. One directory per Go service, each owning its own
Postgres schema and its own typed queries: organization, identity, user,
authorization, audit, office, rtc, messaging, usage, notification, billing,
calendar. Plus `realtime/`, which is this engine imported as a package and
configured with the Redis presence store, the membership identity adapter, the
database template source and the provider registry. It adds nothing the engine
does not expose, and it is the one Node directory in a Go repo.

`plugins/` holds provider implementations, `pkg/` the only shared Go code, `api/`
one OpenAPI spec per service (the frontend's client is generated from them, so a
contract change is a change on both sides by construction), `migrations/` one
directory per schema.

**unityofis-frontend**, private, an Nx monorepo. `apps/` ofis, admin, platform,
mobile (React Native) and desktop (an Electron shell loading ofis). `packages/`
the generated API client, domain core, the realtime client re-exported with the
wrapper's adapter, one package per provider with web and native entry points, and
the web-only and native-only UI that is not in the engine.

### The rules the layout exists to enforce

Checked in CI, here where they apply and in the wrappers for the rest:

- The wrappers depend on the engine's published packages and never copy or fork
  engine code. A duplicated engine file fails lint.
- A Go service reaches another service's data only through that service's API.
  Cross-schema queries are refused by the database roles, not by convention.
- A provider SDK is imported only inside its own provider package.
- Every `packages/` directory except the web-only and native-only ones is
  platform-agnostic. A DOM import there fails lint.
- Generated code is never hand-edited. CI regenerates and fails on drift.
- The public repository's CI has access to no secret. Provider tests exist only
  in the private repositories.

unitykit, the design system, is a separate public repository, installed as a
package by all of them. Both this engine's UI packages and the wrapper's apps
depend on it, so a room bar behaves the same in either — but only the wrapper
uses its `Brand` component, because that is the half that carries identity.

## What done looks like

A stranger clones this repository, runs one command, opens the URL, types an
email and a name, and lands in reception with the map filling the window and no
header of any kind. They move rooms, knock on a locked one, and hold a
four-person call with screen share.

And unityofis runs the same realtime core and the same map inside its own shell,
against its own identity adapter, template source and Redis store, with no
forked code.
