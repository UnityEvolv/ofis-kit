# Spec: <story key> <title>

> One Confluence page per story, in the specifications space, linked from the
> Jira story. Delete the guidance in the quote blocks as you fill it in.

## Problem

> What is wrong or missing today, from the point of view of whoever feels it.
> Not the solution. If the problem is only visible to the team building it, say
> why it matters to the person using the product.

## Scope

> What this story builds, as a list a reviewer can check off. Concrete enough
> that two people would build roughly the same thing.

## Out of scope

> What this story deliberately does not build, especially the things a reader
> would reasonably assume it does. This section prevents most review argument:
> it is cheaper to write the line here than to discover the disagreement in a
> pull request.

## API contract

> Socket events and HTTP endpoints, with their payloads and their refusals.
>
> - Event or endpoint name, following the conventions in `AGENTS.md`
> - Request shape, with an idempotency key on anything that creates
> - Success shape
> - Every refusal, with its stable error code and the message a person sees
>
> A refusal a client cannot distinguish from another refusal is a bug in the
> contract, not in the client.

## Data model

> What is stored, where, and for how long. In ofiskit the honest answer is
> usually "nothing, it is presence in memory" — say so, and say what the
> presence record gains.
>
> Name which adapter answers each question, and confirm the core asks no
> question it cannot ask through one.

## Acceptance criteria

> Observable behaviour, in the order someone would check it. Each line is
> something a reviewer can do and see. The Jira story's "Done when" sentence is
> the starting point; this is that sentence broken into steps.

## Accessibility and theming notes

> Anything beyond [the definition of done](../definition-of-done.md) that this
> story needs: a live-region announcement, a keyboard interaction, a contrast
> decision on top of the background image.

## Open questions

> Anything the spec cannot answer yet, with who is being asked. An open question
> at Spec Review is fine; an unwritten one is not.
