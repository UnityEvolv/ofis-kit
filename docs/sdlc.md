# How a story becomes code

The workflow every story after the setup ones follows. Two human gates, and
everything else automated where it is practical.

## Statuses

```
To Do → Spec → Spec Review → In Progress → In Review → Staging → Ready for Prod → Done
```

## The two gates

Only two things wait for a person:

1. **Approve specification**, leaving Spec Review. Someone has read the spec and
   agrees that building it is the right thing to do. This is the cheap place to
   disagree.
2. **Approve production deployment**, leaving Ready for Prod. Someone decides
   that now is the moment.

Every other transition is driven by a branch, a pull request, or a passing check.
A story moves to In Progress when its branch appears, to In Review when the pull
request opens, and to Staging when it merges.

## The spec

One Confluence page per story, in the specifications space, linked from the Jira
story. It follows [the spec template](specs/TEMPLATE.md): problem, scope, out of
scope, API contract, data model, acceptance criteria.

The out-of-scope section earns its place. Most disagreement in review is about
something the author never intended to build, and writing it down ends the
argument before it starts.

## The repository

- `AGENTS.md` holds the conventions, for a human and an agent alike.
- The pull request template carries the review checklist.
- `main` is protected: a pull request cannot merge with a failing check, and
  every check in [.github/workflows](../.github/workflows) is required.

## Definition of done

[docs/definition-of-done.md](definition-of-done.md). Every story inherits it.
A story that restates it is wasting words; a story that skips it is not done.

## Contributors from outside

A pull request from a fork runs the same workflow, gets the same review
checklist, and is held to the same definition of done. It has access to no
secret, which is what makes the repository safe to open. See
[CONTRIBUTING.md](../CONTRIBUTING.md).
