# <story key> <what this does>

<!-- One or two sentences. What changes for someone using the product? -->

Story: <!-- UO-nnn, or "none" for a drive-by fix -->
Spec: <!-- link to the Confluence page, or "none" -->

## How to check it

<!-- The steps a reviewer follows to see it working. Two browser windows is a
     two-person office, so most of this repo can be checked by hand in a minute. -->

## Review checklist

Tick what applies. An unticked box with a sentence saying why is a fine answer;
an unticked box with no explanation is what review is for.

**Security and permission**

- [ ] Input validated at the boundary, not trusted from the client
- [ ] Permission asked through the identity adapter, never by a lookup
- [ ] Every action the UI disables or hides is refused by the server independently,
      with the same error code
- [ ] No secret added to CI, and nothing here needs one

**Conventions** (`AGENTS.md`)

- [ ] The error envelope is used for every refusal, with a stable code
- [ ] No personal data in logs: IDs yes, names and emails no
- [ ] No hostname, origin or absolute product URL as a literal
- [ ] Dates are instants in UTC on the wire, formatted only on the client, in the
      viewer's zone
- [ ] No `any` without a comment saying why
- [ ] Generated files (icons, `dist`) were regenerated, not hand-edited

**The boundary**

- [ ] The core asks no question it cannot ask through an adapter
- [ ] No provider SDK outside its own adapter
- [ ] No DOM in a platform-agnostic package
- [ ] A wrapper could get this behaviour by configuration, without forking

**Definition of done** ([docs/definition-of-done.md](../docs/definition-of-done.md))

- [ ] Checked in **both** light and dark theme, every colour from a unitykit token
- [ ] Responsive, no horizontal scroll, tap targets usable on a phone
- [ ] Loading, empty and error states handled
- [ ] Keyboard operable with a visible focus ring and a sensible order
- [ ] Labelled for a screen reader; nothing conveyed by colour alone
- [ ] Anything that happens **to** a person is announced through a live region
- [ ] Motion respects reduced-motion
- [ ] Tests beside the code, and they fail without the change
- [ ] Changeset added if a published package changed
