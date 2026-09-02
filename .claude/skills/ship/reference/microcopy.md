# Microcopy — reference for the Voice section of LOOK_AND_FEEL

Authored 2026-07-16 for this factory (distilled from standard UX-writing
practice; no upstream skill vendored — none vetted was worth adapting.
Revisit via a DEP if one appears). Read at intake and vision revision,
before writing LOOK_AND_FEEL.md, alongside design-craft.md. It informs
authoring only — once written, the Voice section of LOOK_AND_FEEL.md is the
sole authority and this file never overrides it. Trigger: a shipped app
whose wording "feels unnatural" throughout (human, 2026-07-16) — every
string passed the walk because there were no product rules to fail.

## Calibration: the text defaults to spend no freedom on

AI-written interface copy has tells, the way AI design has its cream-and-
terracotta look. Recognize them as defaults, not choices:

- **System-speak.** "Invalid input", "Operation completed successfully",
  "Submission received", "Error: field required". The system reporting on
  itself instead of a person being helped.
- **Developer vocabulary leaking.** Users manage *quizzes* and *questions*,
  never records, fields, entries, items, or valid values. Name things by
  what the person controls and recognizes, not how the code stores them.
- **Enthusiasm inflation.** "Awesome!", "Great job!", exclamation marks on
  routine confirmations. A quiz saved is not a triumph.
- **Apology theater.** "Oops!", "Sorry, something went wrong". Errors need
  a fix, not a mood.
- **Hedged emptiness.** "No data available at this time", "There are
  currently no items to display" — twelve words to avoid saying what to do
  next.
- **Title Case On Every Label And Button.** Sentence case reads as human;
  reserve capitals for names.

## The voice comes from the vision

Before writing a single bar, answer from VISION.md: who is being spoken to,
and what register do they expect? A study tool for classmates talks like a
classmate; an ops dashboard talks like a colleague under time pressure.
One product, one voice — the register that is right for the audience is
right on every screen, including errors. Where the vision is silent, pick
the plainest voice that fits and say which vision sentence licenses the
choice, as with every rule in the file.

## Principles worth encoding as bars

- **Verbs first, and the verb is the action.** A control says exactly what
  it does: "Save quiz", "Delete question", never "Submit", "OK", "Confirm".
  An action keeps its name through the whole flow — a "Publish" button
  yields a "Published" confirmation, not "Success".
- **Say what happens next.** Every confirmation names the outcome and where
  it lives ("Quiz saved — it's on your dashboard"), every destructive
  confirm names the consequence with the specifics ("Delete 'Chapter 3
  review'? Its 12 questions go with it"), every loading state says what is
  being waited on.
- **Errors: what happened, then what to do — in that order, no blame.**
  "That link has expired — ask for a new one" beats both "Invalid token"
  and "Oops! Something went wrong on our end, please try again later!".
  If the fix can't be named, the error isn't understood yet; that is a
  design finding, not a copy problem.
- **Empty states are invitations.** What this screen will hold and the one
  action that starts it. Never a bare "No quizzes yet" when "Make your
  first quiz" can sit under it.
- **One name per concept, everywhere.** If the vision calls it a quiz, no
  screen calls it a test, an assessment, or an item. Build the product
  glossary into the Voice section — five nouns, pinned — so two builders
  who never meet write the same labels.
- **Short is a side effect, not the goal.** Cut words that carry no
  information ("currently", "in order to", "please note that") and keep the
  ones that do. A seven-word sentence a person would actually say beats a
  three-word fragment they have to decode.
- **Numbers and dates humanized.** "2 days ago" not "2026-07-14T09:12:00Z";
  "12 questions" not "Count: 12".

## The test that catches everything else

Read the screen's copy aloud. Anything you would not say to the person
sitting next to you — as the product's chosen voice, helping them do the
thing — gets rewritten. This is the walk's judgment too, so write bars the
read-aloud test can enforce.

## Writing the Voice section: bars, not vibes

Fold the above into LOOK_AND_FEEL.md as a **Voice** section: the register
in one sentence, the pinned glossary, and 3–6 walkable bars. The fork test
applies per line, as everywhere in that file: a bar earns its place only if
it changes what a builder writes or what the endgame walk flags. Bars must
be checkable against a rendered screen — "friendly but not chatty" is an
opinion; "every button starts with a verb naming its action" and "every
error names its fix" are bars.
