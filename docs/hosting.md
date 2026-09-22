# Hosting ofiskit

ofiskit is one Node process and a web app. It needs no database, no account with
anybody and no service of ours. Everything it runs is yours: the process, the
optional relay, and the office layout in `config/`.

There are four ways to run it, from trying it on a laptop to putting it on the
internet for a team:

| | What you get | Calls work |
| --- | --- | --- |
| [Development](#1-development) | The server and the app, reloading as you edit | On this machine |
| [One process](#2-one-process) | The built app and the office on one port | On the same network |
| [Docker Compose](#3-docker-compose) | The app, the office and a relay, in three containers | Through most firewalls |
| [A public server](#4-a-public-server) | Compose behind HTTPS, on a domain | For anybody, anywhere |

There is also [the browser-only demo](#the-browser-only-demo), which runs the
whole office in a tab and needs no server at all.

## Before you start

- **Node 20 or later** for the first two. Docker for the other two.
- **Camera and microphone need HTTPS.** Browsers allow them only on `https://` or
  on `localhost`. Anything you open by IP address or plain `http://` hostname
  shows the office but cannot start a call.
- **Nothing is stored.** Restart the process and everyone reconnects to an empty
  office. That is the design, not a missing feature: there is no database to
  back up or migrate.

## 1. Development

```
npm install
npm run dev
```

This builds the packages, then runs the server on port 4000 and the app (Vite)
on port 5173, both watching for changes. Open `http://localhost:5173`. The app
passes the socket and the office's requests through to the server, so it is one
origin from the browser's point of view.

A private window, or a different browser, is a second person. Two tabs of one
browser are the same person, because they share the device and presence is per
person.

## 2. One process

```
npm install
npm run build
node server/dist/index.js
```

One process serves the built app, the office and the socket on port 4000. Open
`http://localhost:4000`. This is also what the server container runs.

With no relay configured, calls connect between people on the same network and
may not connect across a corporate firewall. The entry screen says so.

## 3. Docker Compose

```
docker compose -f deploy/docker-compose.yml up
```

Open `http://localhost:8080`. Three containers, because they are three things:

- **app**: nginx serving the built app on port 8080. It forwards the socket and
  the office's requests to the server, so the browser sees one origin and there
  is no CORS to configure.
- **server**: the Node process, holding presence and relaying call setup.
- **coturn**: a TURN relay, for calls between people on networks that block
  direct connections. Most calls never use it.

`config/` is mounted into the server read-only, so editing the office is an edit
and a restart, with nothing rebuilt.

**Docker Desktop on Mac or Windows:** coturn uses host networking, which is a
Linux feature. On Docker Desktop the relay may not be reachable. On a laptop
that is harmless, because two browsers on one machine never need a relay. It
only matters on a server, and servers are Linux.

## 4. A public server

What a team uses: Compose on a Linux machine with a public address, behind a
reverse proxy that provides HTTPS.

### The machine

Any Linux VM with a public IPv4 address and Docker. The office itself is light:
one process and a few megabytes per person. What costs is relayed video, which
crosses the relay twice. The limits in `deploy/docker-compose.yml` are sized for
about 100 relayed video streams at once; read the comment there before changing
them.

### DNS

Point a name you own at the machine, for example `office.example.com`, with an
`A` record. The relay can use the same name.

### Firewall

| Port | Protocol | For |
| --- | --- | --- |
| 80, 443 | TCP | HTTPS, and the certificate authority's check |
| 3478 | UDP and TCP | The relay's listening port |
| 49152–65535 | UDP | The relay's media ports |

Keep port 8080 closed to the internet. Only the reverse proxy talks to it.

### Settings

Put these in a `.env` file beside the compose file, or in the environment. Every
one of them is described in [the settings reference](#settings-reference).

```
TURN_SECRET=<a long random string>
TURN_URLS=turn:office.example.com:3478?transport=udp,turn:office.example.com:3478?transport=tcp
STUN_URLS=stun:office.example.com:3478
```

**Change `TURN_SECRET`.** The compose file has a default so that `up` works on a
laptop with no setup. On a public server that default is a secret everybody has,
and your relay becomes anybody's relay. Generate one with
`openssl rand -hex 32`.

`TURN_URLS` and `STUN_URLS` are addresses a **browser** has to reach, which is
why they cannot be worked out by the server. Use the public name, never
`localhost` and never a container name.

### HTTPS

Put any reverse proxy in front of port 8080 that terminates TLS and passes
websockets through. [Caddy](https://caddyserver.com) does both, and gets and
renews the certificate itself. A whole `Caddyfile`:

```
office.example.com {
	reverse_proxy localhost:8080
}
```

With nginx, Traefik or a cloud load balancer instead, the one thing to get right
is forwarding `/socket` as a websocket: pass the `Upgrade` and `Connection`
headers, and allow long-lived connections (an hour or more).

### Starting it

```
docker compose -f deploy/docker-compose.yml up -d --build
```

Check `https://office.example.com/healthz`: it answers with the number of people
and sockets, and is what the container's health check calls.

To update, pull and run the same command again. Everyone reconnects to an empty
office, which takes a second.

### A public demo

If anybody with the link may walk in, set `DEMO=true`. The entry screen then
says that this is a public demo, and not to say anything private in it.

## Settings reference

Read by `server/src/config.ts` once at start. That file is the only place in the
repository allowed to name a host or a port, and it names none of yours.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4000` | The port the process listens on. In Compose this is the server's; the app's is `PORT` on the `app` service, default `8080`. |
| `HOST` | `0.0.0.0` | The address to bind. The default suits a container. |
| `CONFIG_DIR` | `config/` | Where `template.json` and the office's pictures are. |
| `TEMPLATE_PATH` | `CONFIG_DIR/template.json` | The layout, if it lives somewhere else. |
| `APP_DIR` | `app/dist` | The built app this process serves. |
| `WATCH_TEMPLATE` | `true`, or `false` when `NODE_ENV=production` | Re-read the template when the file changes. |
| `OFFICE_ID` | `office` | The office's id. One process is one office. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Logs never contain names, emails or photos. |
| `PRESENCE_GRACE_MS` | `30000` | How long somebody stays in their room after their last device drops, so a flaky connection is not a departure. |
| `ALLOWED_ORIGINS` | none | Other origins allowed to open the socket, comma separated. Empty means the app's own origin only, which is right unless you host the app elsewhere. |
| `TURN_SECRET` | none | The secret shared with the relay. It mints short-lived credentials per call; nothing else sees it. |
| `TURN_URLS` | none | Relay addresses for browsers, comma separated. Empty means no relay. |
| `STUN_URLS` | none | STUN addresses for browsers, comma separated. |
| `TURN_TTL_SECONDS` | `43200` | How long a relay credential lasts. |
| `DEMO` | `false` | Public demo mode: a warning on the entry screen. |

## Your own office

The office is the files in `config/`:

```
config/template.json                       the rooms, their geometry, where each bar sits
config/office-cutaway-landscape.svg        the picture they are drawn on
config/office-cutaway-landscape-dark.svg   optional, the same office at night
```

To make your own, open the builder at `/builder` on any running copy, or on the
demo. It walks you through three steps: a prompt for generating the picture,
uploading it (and generating a dark version from an SVG), and placing rooms. It
downloads `template.json` and tells you what to name the pictures. Put them in
`config/`, restart, and that is your office.

## The browser-only demo

The Pages build runs the entire office inside the browser: one tab hosts it and
every other tab on the device joins it, with a few simulated colleagues to make
it lively. It is static files, so any static host serves it, but everybody in it
is on one device.

```
PAGES_BASE=/ npm run build:pages
```

The output is `app/dist-pages/`. Set `PAGES_BASE` to the path the site is served
from: `/` at the root of a domain, or `/<repository>/` on GitHub Pages without a
domain of its own.

On a fork, `.github/workflows/pages.yml` deploys it for you on every merge to
`main`. Turn on Pages in the repository's settings with **GitHub Actions** as the
source. It uses the repository's name as the path unless a `PAGES_BASE`
repository variable says otherwise.

## When something is wrong

- **The office loads but calls never connect.** You are on plain `http://` or an
  IP address. Use HTTPS, or `localhost`.
- **Calls connect in the office, but not from home or another company's network.**
  No relay is configured, or browsers cannot reach it. Check `TURN_URLS` uses the
  public name, and that UDP 3478 and 49152–65535 are open.
- **The page loads but says the office is not answering.** The server is down, or
  the proxy is not forwarding `/config`, `/v1`, `/office` and `/socket` to it.
- **People appear, then vanish after a minute.** The proxy is closing idle
  websockets. Raise its read timeout to an hour or more.
- **The office is empty after an update.** That is expected: nothing is stored,
  and everyone who still has the page open is back in a second.
