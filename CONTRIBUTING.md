# Contributing to ofiskit

Pull requests are welcome, including from people who have never seen this
codebase. Read [AGENTS.md](AGENTS.md) first: it is the conventions, and it is the
same document the people who work on unityofis follow.

## Getting it running

```
npm install
npm run dev
```

That is the server and the app, both watching. Open the URL it prints, type an
email and a name, and you are in reception. Two browser windows is a two-person
office.

The office itself is `config/template.json` and the background image beside it.
Change those and you have changed the office; nothing else needs to know.

## Before you open a pull request

```
npm run lint
npm run typecheck
npm test
```

CI runs the same things plus a two-browser call test on fake devices, a bundle
budget, and an accessibility check. A pull request cannot merge with a failing
check.

If your change is visible to someone using a published package, add a changeset:

```
npm run changeset
```

## What review will ask

The pull request template carries the checklist. The three things that come up
most often:

- **Both themes.** Every screen is checked in light and dark. No hard-coded
  colours; everything comes from a unitykit token.
- **Keyboard and screen reader.** The map is the hardest part of the product to
  use without sight or a mouse, and it has more rules than the rest. See
  [the definition of done](docs/definition-of-done.md).
- **The server refuses it too.** A disabled button is a convenience. If the UI
  hides an action, the core must refuse the event as well, with the same error
  code.

## Where your change belongs

The line between the engine and its host is the whole architecture, so the most
common review comment is that a change is in the right shape but the wrong place.
[docs/architecture.md](docs/architecture.md) has the detail. The short version:

- A permission question is an **adapter call**, never a lookup. The core cannot
  ask who someone's colleagues are, and it should not learn how.
- A layout read is the **template source**.
- Anything storing who-is-where is the **presence store**.
- Anything provider-specific is behind the **RTC provider interface**, in both
  halves, and its SDK stays inside its own adapter.

If a change needs the core to know something it cannot ask through one of those,
it probably belongs in unityofis, or the interface needs a new question. Both are
fine answers. Open an issue and we will work out which.

## Security

Please do not open a public issue for a vulnerability. Email
security@unityevolv.com instead.

One thing worth knowing: **CI here has access to no secret at all.** Not a
provider key, not a token. A pull request from a fork runs the same workflow as
one from a maintainer, and there is nothing for it to exfiltrate. That is what
makes this repository safe to open, and it is why provider tests live only in the
private repositories.

## Licence

The app, the server and the UI packages are AGPL-3.0-only. The interface packages
(`template`, `presence-store`, `adapters`) are Apache-2.0, so that building
against the interfaces is not a licensing decision. By opening a pull request you
agree that your contribution is licensed the same way as the file it touches.
