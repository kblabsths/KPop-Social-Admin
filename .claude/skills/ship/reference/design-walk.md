# Endgame walk — phased procedure for the Designer's milestone walk

Adapted 2026-07-15 from OneRedOak/claude-code-workflows' design-review agent
(MIT, (c) 2025 Patrick Ellis), re-cut for this factory: playwright-python
instead of MCP browser tools, LOOK_AND_FEEL.md in place of their generic
design-principles file, BUG tickets instead of PR comments. This file adds
*procedure* only. LOOK_AND_FEEL.md is the sole authority on taste — where
the two seem to disagree, the product's own file wins.

Doctrine: **live environment first.** Judge the interactive experience
before reading any code. The walk exists to see what a user sees.

## Phases — in order, so no walk silently skips one

0. **Prep.** Launch the app; desktop viewport 1440x900. Know which screens
   and flows this milestone added or touched — they get the closest look,
   but the walk covers every key screen in LOOK_AND_FEEL.md.
1. **Flows & interaction.** Primary user flows end to end. Interactive
   states on the way: hover, active, disabled, loading. Destructive actions
   confirm before acting. Perceived responsiveness against the Feel bars.
   **Force each control's hover and focus state and judge it — don't just
   pass the cursor.** Static screenshots hide these states entirely, which
   is how a button whose hover fill swallowed its own label survived a
   walk (2026-07-16, publish button). `page.hover()` / focus the control,
   then screenshot the primary action of each screen in its hover and
   focus states as evidence.
2. **Responsiveness.** Desktop 1440 → tablet 768 → phone 375
   (device-emulate). Layout adapts; no horizontal scroll; no overlap;
   touch targets usable at phone size.
3. **Visual polish vs the Look.** Alignment and spacing on the scale; type
   hierarchy per the type rules; palette conformance (no off-token colors);
   visual hierarchy guides attention to the screen's one primary action.
4. **Accessibility.** Full keyboard pass: Tab order sensible, Enter/Space
   activate, focus visibly marked on every interactive element. Form fields
   labeled. Images carry alt text. Text contrast at least 4.5:1 — **in
   every state, not just resting: a label must stay readable while its
   control is hovered, focused, and active.**
5. **Robustness.** Invalid input into every form; overflow content (long
   titles, long names); loading, empty, and error states each judged
   against the Feel bars — empty states direct, errors name their fix.
6. **Content & console.** Every visible string against the Voice section's
   bars and glossary — buttons, errors, empty states, confirmations, labels
   (not just the strings this milestone added: voice drift is cumulative).
   Then the read-aloud test: anything a person wouldn't say to the person
   next to them, in the product's chosen register, is a finding even if no
   bar names it — cite the register line. Browser console clean — errors
   and warnings there are findings too.

## Reporting

- **Problems over prescriptions.** Describe the problem and its impact
  against the named rule or bar, not the fix: "spacing sits off the scale
  and the screen reads as cluttered (Look: spacing rule)" — not "change
  margin to 16px."
- **Severity → ticket priority.** Breaks a key flow or a Feel bar on a
  central screen: P1. Visible rule violation: P2. Minor/cosmetic: P3, or a
  one-line nit in the walk summary if it wouldn't earn a builder session.
- Every finding: screenshot in the evidence directory + the rule or bar it
  violates (both already required by your definition). A clean phase is
  reported plainly — never invent findings to seem thorough.

## Mobile target?

Walking an emulator or native app (STACK.md says so)? Read
`reference/mobile-walks.md` FIRST — device etiquette lives there, not here.
