# ofiskit

A virtual office you can run yourself. One floor plan, people standing in rooms,
and a four-person call in any of them.

```
git clone https://github.com/UnityEvolv/ofis-kit
cd ofis-kit
docker compose -f deploy/docker-compose.yml up
```

Open the URL it prints, type an email and a name, and you are in reception. A
second browser window is a second person. Three containers, five minutes, and a
team is in a room.

## What it is

The office is a picture of a floor plan with rooms drawn over it. You walk
between rooms, you can see who is in each one and what they are doing, and
pressing the microphone in a room starts a call with the people in it. A room
can be locked; somebody outside can knock; anyone inside can let them in.

It is also the engine behind unityofis, and it is the *whole* engine. The
product is a wrapper around this code, not a different program — the same
realtime core, the same map, the same call. What the wrapper adds is
configuration: its own identity adapter, its own template source, Redis instead
of memory, and more RTC providers.

## What it is not

No accounts, no passwords, no verification. No database. No chat, no admin, no
roles, no second office. Restart the server and everyone reconnects to an empty
office, because there was never anywhere for the office to be kept.

**And no branding.** There is no header, no navigation and no product identity:
the map fills the window and the controls bar sits at the bottom. Nothing in it
names ofiskit or unityofis anywhere a person can see, and the repository carries
no logo, no favicon and no icons of ours. A team self-hosting this is running
*their* office, not somebody else's product, and whoever hosts it decides what
goes in the browser tab.

None of these absences is work left undone. They are what makes the boundary
provable: with nothing here to query, every permission question *has* to be an
adapter call, and the free office and the product cannot quietly drift apart.

## The office is two files

```
config/template.json                  the rooms, their geometry, where each bar sits
config/office-cutaway-landscape.svg   the picture they are drawn on
```

The template names the picture for each theme (`images.light`, and optionally
`images.dark`), so it can be any PNG, JPEG, WebP, AVIF or SVG in `config/`.

Replace those and you have replaced the office. The builder — a standalone page
in the same app, with no server side — draws a layout on a background image and
exports `template.json`; it also hands you a prompt for generating the picture.

## Building on it

The interfaces are published separately and under Apache-2.0, so building
against them is not a licensing decision:

| Package | What it is |
| --- | --- |
| `@unityevolv/ofiskit-template` | The layout schema and its geometry validator. |
| `@unityevolv/ofiskit-presence-store` | Who is where: the interface, and the in-memory store. |
| `@unityevolv/ofiskit-adapters` | Identity, template source, event bus, rate limiting. |

The engine, the realtime client and the UI packages are AGPL-3.0-only:
`ofiskit-realtime-core`, `ofiskit-realtime-client`, `ofiskit-ui-map`,
`ofiskit-ui-builder`.

Everything the office needs from its host arrives through one of four
interfaces — identity, template source, presence store, and the RTC provider.
[docs/architecture.md](docs/architecture.md) explains where the line is and why
it is drawn there.

## Developing

```
npm install
npm run dev      # the server and the app, both watching
npm test         # unit and component tests
npm run lint     # including the rules that keep the boundary honest
```

[AGENTS.md](AGENTS.md) holds the conventions, for a human and an agent alike.
[CONTRIBUTING.md](CONTRIBUTING.md) is what to expect from review. CI here has
access to no secret at all, which is what makes the repository safe to open.

## Licence

AGPL-3.0-only for the app, the server and the UI packages. Apache-2.0 for the
three interface packages, so that writing an adapter is not a licensing
decision. Each package's `license` field is the authority.
