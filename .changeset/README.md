# Changesets

A changeset is a note, written when you make the change, saying which packages
it affects and how much: a patch, a minor or a major version. Version numbers
and changelogs are worked out from those notes at release time, so nobody has to
remember what happened over a fortnight of merges, and nobody edits a version
number by hand.

```
npm run changeset
```

It asks which packages changed and how, then writes a Markdown file here.
Commit it with the change, and say in it what a person using the package would
notice — the file becomes their changelog entry, and "fixed a bug" tells them
nothing.

A change nobody using a published package can see (a test, the demo, the docs,
this repository's own tooling) needs no changeset.

`app` and `server` are ignored here: they are this repository's own host, not
published, and they are versioned by nothing at all.

The releasing itself is in [CONTRIBUTING.md](../CONTRIBUTING.md#releasing).
