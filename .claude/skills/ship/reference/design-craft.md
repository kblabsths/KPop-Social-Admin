# Design craft — reference for LOOK_AND_FEEL authoring

Adapted 2026-07-15 from Anthropic's `frontend-design` skill
(github.com/anthropics/skills, Apache-2.0), trimmed to the Designer's
authoring moment: this factory's designer writes a design *language*
(LOOK_AND_FEEL.md), not code. Read this at intake and vision revision,
before writing that file. It informs authoring only — once written,
LOOK_AND_FEEL.md is the sole authority and this file never overrides it.

## Calibration: the defaults to spend no freedom on

AI-generated design currently clusters around three looks: (1) a warm cream
background (near #F4F1EA) with a high-contrast serif display and a terracotta
accent; (2) a near-black background with a single bright acid-green or
vermilion accent; (3) a broadsheet-style layout with hairline rules, zero
border-radius, and dense newspaper columns. All three are legitimate when the
vision asks for them — but they are defaults, not choices, and they appear
regardless of subject. Where the vision pins a visual direction, follow it
exactly; where it leaves an axis free, do not spend that freedom on a
default. When you reject a default, name what you reach for instead — an
avoidance without a replacement collapses back to the default under pressure.

## Ground the language in the subject

Distinctive choices come from the product's own world — its materials,
artifacts, vernacular, and audience — not from a generic palette generator.
Name the subject, its audience, and each key screen's single job before
choosing tokens; derive the palette and type mood from those, and be able to
say which VISION sentence licenses each choice (the file already requires
this — this is *how* you find the answer).

## Principles worth encoding as rules

- **The first screen is a thesis.** Open with the most characteristic thing
  in the product's world. A big number with a small label plus a gradient
  accent is the template answer — use it only if it is truly best here.
- **Typography carries the personality.** Pair display and body faces
  deliberately — not the families you would reach for on any other project —
  and make the type treatment itself memorable, not a neutral delivery
  vehicle. Set the scale with intentional weights and spacing.
- **Structure is information.** Numbering, eyebrows, dividers, and labels
  must encode something true about the content, not decorate it. Numbered
  markers (01/02/03) only where the content really is a sequence.
- **Motion is deliberate.** One orchestrated moment lands harder than
  scattered effects — and extra animation is itself a tell that a design is
  AI-generated. Sometimes the right amount is none.
- **Match complexity to the vision.** Maximalist directions need elaborate
  execution; minimal directions need precision in spacing, type, and detail.
  Elegance is executing the chosen vision well.

## Process: two passes

1. **Token system first.** Palette as 4–6 named hex values, each with a job.
   Type for 2+ roles: a characterful display face used with restraint, a
   complementary body face, a utility face if data/captions need one. A
   layout concept in one-sentence prose (ASCII wireframes to compare
   options). A **signature**: the single element this product will be
   remembered by.
2. **Critique before committing.** Review the draft against the vision: any
   part that reads like the generic answer you would produce for *any*
   similar product — revise it, and say what changed and why. Only then
   write the final LOOK_AND_FEEL.md, deriving every rule from the revised
   plan.

## Restraint

Spend your boldness in one place. Let the signature element be the one
memorable thing; keep everything around it quiet and disciplined; cut any
decoration that does not serve the vision. And hold the quality floor
without announcing it — responsive down to phone, visible keyboard focus,
reduced motion respected. Floor items belong in the Feel bars so the endgame
walk checks them.

## Words are design material

Copy can make a design feel as templated as the visuals. The dedicated
reference (`microcopy.md`, read alongside this file) goes deeper; the Voice
section of LOOK_AND_FEEL.md is where all of it becomes walkable bars. The
essentials that also belong in component rules:

- Name things by what people control and recognize, never by how the system
  is built (a person manages notifications, not webhook config).
- Active voice; a control says exactly what happens ("Save changes", not
  "Submit"), and an action keeps its name through the whole flow (a
  "Publish" button produces a "Published" toast).
- Errors explain what went wrong and how to fix it, in the interface's
  voice — never apologetic, never vague. An empty screen is an invitation
  to act, not a mood.
- Each element does exactly one job: a label labels, an example
  demonstrates, nothing quietly does double duty.
