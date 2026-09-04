# Look and Feel — the Admin window

Derived 2026-09-01 from `VISION.md` (frozen) and the human's approved
`contracts/admin-observability.md`, plus a code walk of the deployed app
(`src/app/**`, Tailwind 4.2.2, Next 16). The contracts decide *what* is
rendered; this file decides *how it looks, how it behaves, and how it talks*,
and it is the only thing the endgame walk judges against.

**Brownfield stance.** Every existing *surface* is deprecated (spec §3), but
the app's design *language* is not: it is a dense, square-cornered,
mono-heavy operator console, and that fits "Ben, the ecosystem's operator, at
breakfast … a fluent operator, not a newcomer" better than anything I would
invent. So the language below is mostly the app that exists, tightened where
it drifted (seven ad-hoc type sizes, unreadable gray, five accent colors).
Where I correct the old app rather than document it, the line says so.

**Out of scope:** `/login`. The sign-in gate carries over untouched (spec §3),
so its rounded card, pink mark and drop shadow are sanctioned exceptions —
neither a precedent to copy nor a violation to file. Nothing else in the app
uses pink, a radius above 4px, or a shadow.

---

## The Look

### Palette — five colors, named jobs

The gray ramp is the app; color is reserved for state. Values are Tailwind
4.2's tokens (given as hex so a builder without Tailwind produces the same
screen). Every surface ships light and dark.

| Job | Light | Dark | Token |
| --- | --- | --- | --- |
| Page background | `#f3f4f6` | `#030712` | gray-100 / gray-950 |
| Surface (cards, tables, panels) | `#ffffff` | `#101828` | white / gray-900 |
| Chrome (sidebar, table header, chips) | `#f9fafb` | `#1e2939` | gray-50 / gray-800 |
| Hairline (all borders, all dividers) | `#d1d5dc` | `#364153` | gray-300 / gray-700 |
| Primary text | `#1e2939` | `#e5e7eb` | gray-800 / gray-200 |
| Secondary text (labels, sub-detail) | `#4a5565` | `#99a1af` | gray-600 / gray-400 |
| Disabled / placeholder / null only | `#99a1af` | `#4a5565` | gray-400 / gray-600 |
| **Accent** — selection, active nav/tab/chip, focus, primary button | `#9810fa` | `#c27aff` | purple-600 / purple-400 |
| **Healthy** — succeeded, settled, applied | `#016630` | `#05df72` | green-800 / green-400 |
| **Needs a human** — open items, `high` severity | `#bb4d00` | `#ffb900` | amber-700 / amber-400 |
| **Broken** — failed run, error line, irreversible action | `#c10007` | `#ff6467` | red-700 / red-400 |

- **In light theme a state colour is the ramp's dark step, never its mid
  step** — that is bar 12, not taste. Ratios are measured against `page`
  (`#f3f4f6`), the darkest of the three fills text sits on and therefore the
  one that decides: secondary 6.87:1, healthy 6.48:1, broken 5.83:1,
  attention 4.57:1. **Amber holds at the 700 step** because 800 stops reading
  as amber; 4.57:1 is the palette's floor and its tightest ratio. The mid
  steps this replaces — green-600 3.22:1, amber-600 3.20:1 (3.06:1 on chrome,
  and amber is the `high` severity colour), red-600 4.33:1, gray-500 4.39:1 —
  all failed bar 12 on measurement, 2026-09-02. Do not "restore" them. Dark
  theme is unchanged and passes throughout; its floor is accent purple-400 on
  chrome at 5.25:1.
- **The disabled gray is exempt by job, not by oversight.** Disabled,
  placeholder and the null `—` measure ~2.4:1 in both themes and must: a null
  may never read as loud as a value. It is the only ink below 4.5:1, and it
  never carries a word a person acts on — `text-gray-400`-as-secondary-text
  (the deprecated app's most-used class, 124 uses in `src/`) stays banned.
- **Text on an accent fill is white in light and page-ink in dark**
  (`#030712` on purple-400 = 7.21:1; white on purple-400 measures 2.79:1 and
  is banned). One job, two values — sanctioned deviation from "accent fill,
  white text", and the primary button and active chip never choose for
  themselves.
- **Blue is retired.** The old app's blue info banners and blue "upcoming"
  counts become gray — absence and information are not states.
- **Severity is a color, not a scale**: `high` = amber, `low` = gray. No
  gradient, no third color, no computed score (spec parks the severity
  formula; VISION: "no severity formula").
- Red means *broken*, never *unavailable*. A missing backing table is gray.

### Typography — one family pair, five steps

`Geist` (sans) and `Geist Mono` (mono), already loaded in the root layout.
**Mono carries every value the database produced** — counts, ids, timestamps,
values, source names, buckets, tiers, error strings. Sans carries every word
the app wrote — labels, headings, buttons, prose. That split *is* the
typographic idea: the operator can always see which words are the machine's.

| Step | Size / line | Face | Used for |
| --- | --- | --- | --- |
| `figure` | 20 / 24, semibold | mono | the one number on a stat or gauge card |
| `title` | 14 / 20, semibold, uppercase, +0.05em | sans | page h1 and section h2, nothing else |
| `body` | 12 / 18 | sans | buttons, nav, prose, form labels |
| `data` | 11 / 16 | mono | table cells, values, chips, badges, inline detail |
| `micro` | 10 / 14, uppercase, +0.05em | sans | the eyebrow label above a value |

- Nothing outside these five steps. The existing app's `text-[9px]`,
  `text-xl` and `text-2xl` do not survive.
- `micro` never carries information needed to act — only the label above a
  value that carries it.
- Weights: 400 and 600 only.

### Spacing, borders, density

- **Spacing scale: 2, 4, 6, 8, 12, 16, 24 px**, px-exact — the unit is
  pinned to 4px rather than a rem multiple, so this density never drifts with
  the browser's root font size (sanctioned deviation, not a defect). Nothing
  outside the scale. Table cell padding is 8 horizontal / 6 vertical; card
  padding 12; page padding 16; the gap between page sections 16.
- **Radius: 0 for containers** (cards, tables, panels, banners), **4px for
  interactive controls** (buttons, chips, nav items, inputs), full round for
  status dots. No other radius anywhere.
- **1px hairlines, never shadows.** Structure comes from rules and fills.
  There is no elevation in this app.
- **Frame:** a 192px fixed left sidebar (chrome fill, hairline right edge)
  listing the six pages as **text labels — no icons**; the deprecated app's
  unicode glyphs (`◈ ◫ ≣ ◈̈`) are dropped, one of which is a combining-mark
  hack that renders differently per platform. Active item = chrome-inverse
  fill (gray-200 / gray-700) with primary text (11.9:1 / 8.3:1) — always one
  step off the chrome it sits in, which in dark is gray-800 already, so a
  gray-800 active item would be invisible there. Sign-out sits at the bottom
  behind a hairline. Content is 16px-padded; there is no global status strip
  — the Dashboard owns health.
- **Viewport: the frame is desktop-only, 1280px wide and up.** Supported range
  is 1280px to no upper bound; the design target is 1440x900 (bar 1). Above the
  target the content column takes the extra width and the sidebar never does.
  The frame does not respond: no breakpoint, no collapsed or stacked sidebar,
  no phone layout. **Below 1280px the app is unsupported in M1, and nothing a
  narrow viewport does is a violation** — at 390px the 192px sidebar takes 49%
  of the screen and the Dashboard's attention counts wrap one word per line
  (measured, BUG-0050); that is recorded, not a defect. Ben ruled it 2026-09-02:
  this is a desktop tool for "Ben, the ecosystem's operator, at breakfast"
  (VISION), a phone layout is a nice-to-have for a later milestone, and the bar
  it must meet is written into this bullet before it is built. Width is the only
  axis narrowed here — **both themes ship at every supported width** (bar 12),
  and containment holds at every width: the page never scrolls horizontally,
  only a table inside its own border.

### Component rules

**Data table** — the app's default surface, and most pages are one. Surface
fill, 1px border, chrome-filled header row of `micro` labels; rows separated
by 1px hairlines; hover fills the row with chrome; **no zebra striping and no
vertical rules**. Cells are `data`. Sortable headers are links carrying an
arrow (`↑`/`↓` in accent when active, `↕` in disabled-gray when not). A null
renders as `—` in disabled-gray — never blank, never `null`, `N/A` or `none`.
Tables that exceed their width scroll horizontally *inside their own border*;
the page does not.

**Stat / gauge card** — square, 1px border, surface fill, 12px padding:
`micro` label, then the `figure` number (thousand-separated), then at most one
`data` line of sub-detail. Color on the figure only when it carries a state
from the palette above.

**The evidence pair — this app's signature.** Wherever a contested fact
appears (review-item detail, claim detail, the edit surface's provenance
line), it renders as cards in one row: **the contending claims on the left,
the current canonical value as the rightmost card**, hairline-separated and
visibly labelled as current. Every claim card carries, in this fixed order:
the **value** (`data`, primary text), then `source · tier · age` in
secondary. The canonical card adds its provenance line
(`ticketmaster, applied 3d ago` / `admin-set Jun 12`). The order and the
anatomy never change between screens — that repetition is what lets the
operator read a conflict in two seconds. **Verdict actions live on the card
they act on** (choosing a value is one control inside that claim's card),
never collected into a separate toolbar.

**Buttons** — `body` sans, 4px radius, 6/12 padding. **One primary per
screen**: accent fill, white text. Everything else is secondary: 1px hairline
border, transparent fill, primary text. An action that writes canonical or
settles an item is styled destructive: red border and red text, never a red
fill. Disabled = 50% opacity, `not-allowed` cursor, and **the label does not
change** — a working button never becomes "…".

**Inputs and inline edit** — the click-to-edit cell survives from the old app
and re-earns its place: click a value, it becomes an input with a 1px accent
border; Enter or blur saves, Escape reverts. Confirmation is a green `data`
word beside the field for 1.5s; failure is a red `data` line that names the
failure, and the field reverts to its old value. Every focusable element
shows a 2px accent outline at 1px offset on keyboard focus — no exceptions,
no `outline: none`.

**Chips and badges** — `data` mono, 4px radius, 2/8 padding. A *filter chip*
is interactive: active = accent fill + white; inactive = chrome fill +
secondary text. A *badge* is not interactive and is always chrome fill with
primary text (tier, kind, bucket, shape) — **only severity and health carry
color**, so a page of sources is not a rainbow.

**The four states, mandatory on every data surface** — a surface that can
render rows must render all four:
1. **Loading** — one `data` line naming what is loading ("loading cycles…").
   Spinners appear only inside a button.
2. **Empty** — surface card, naming what the surface will hold and the one
   thing that fills it.
3. **Not provisioned** — surface card with a hairline border and secondary
   text naming the missing table and what creates it. Gray, never red, never
   a zero that reads like data.
4. **Error** — one red `data` line naming what failed and the retry.

**Motion** — 120ms color transitions on hover and active state, and the 1.5s
save confirmation. That is the entire motion budget: no page transitions, no
skeleton shimmer, no animated counters, and nothing pulses or blinks (the old
header's `animate-pulse` stale dot is gone).

---

## The Feel

### Quality bars — every one checkable against the running app

1. **The question is answered above the fold** at 1440×900 without scrolling:
   Dashboard shows decision and signal counts; Queues shows the open count of
   each queue; Claims shows every bucket with its count; Sources shows each
   source's lifecycle and tier; Cycles & runs shows the newest run with its
   counts and error; Browse shows the newest event.
   *(VISION: "did anything happen last night, what needs me, who keeps being wrong")*
2. **Two queues of equal standing.** The decision queue and the signal queue
   render at the same width, the same type scale and the same level of the
   page. Neither is nested inside, beside, or beneath the other, and neither
   is styled as the primary inbox. *(spec §4 rationale)*
3. **`in_window` appears nowhere** — not as a bucket row, not as a filter
   option, not as a zero, on any page. *(spec §4; VISION non-goal)*
4. **Absence is honest.** Every ecosystem page, against a database without
   its backing table, renders the not-provisioned state naming that table.
   No page throws, no page shows an empty frame, and no missing table renders
   as `0`. *(VISION: "every page says so honestly and nothing crashes")*
5. **Provenance shows at the fact**, on review-item detail, claim detail and
   every editable field — and there is no provenance page in the nav.
   *(spec §4 rationale; VISION: "provenance is visible at the field")*
6. **Severity is the registry's word.** Every ranked list shows `low` / `high`
   verbatim and states its sort ("open first, severity then age") on screen.
   No score, no computed rank, no number. *(VISION non-goal: "no severity formula")*
7. **A settlement resolves in place.** After a verdict or an override, the
   item's new state — settled, with its action — replaces the controls in the
   same view, with no full-page reload and no instruction to refresh.
   *(VISION: "settles the questions only a human can settle")*
8. **An irreversible write states its subject first.** Any control that
   writes canonical names the fact and the value it will write before it
   fires. *(VISION: "every change is attributed")*
9. **Keyboard reaches everything.** Every action on every page is reachable by
   Tab with a visible focus ring, and no verdict, sort, or edit is available
   only on hover.
10. **The investigation never leaves the app**: from any review item you can
    reach its claims, from a claim its source and the fact's provenance, from
    an event its edit surface — each in one click, each a real URL.
    *(VISION: "item → its claims → its source and provenance → the event → its edit surface")*
11. **State lives in the URL.** Every filter, sort, and page position is
    bookmarkable and survives the back button — the breakfast view is a link.
12. **Both themes, clean console.** Every page renders in light and dark with
    nothing invisible, and every string a person reads to act measures ≥4.5:1
    against the fill behind it — `page`, `surface` or `chrome`; the active nav
    item's chrome-inverse fill carries primary text only, and the
    disabled/placeholder/null gray is exempt by job (see the palette). No
    browser-console error or warning on load.

### Key screens

- **Dashboard** — at a glance: did anything happen, and does anything need
  me. Two attention counts side by side (decisions, signals) with max
  severity and oldest age, last night's cycles and runs, error lines verbatim.
  Every number links to the page that explains it.
- **Queues** — two lists of equal standing, open first, severity then age,
  filterable by shape. A row must read as one sentence: what happened, how
  old, how many times folded.
- **Review item detail** — the evidence pair, and the close beside it. The
  operator must be able to decide without opening another tab: contenders,
  canonical, tiers, ages, and the note field.
- **Claims** — the classification view: buckets with counts and age, and the
  standing-disagreements tab. It answers "what is stuck, and whose fault".
- **Edit surface** — the field, its value, its provenance, and whether it is
  admin-locked, on one line. Editing must never hide where the value came
  from.

Sources, Cycles & runs, and Browse are the data-table rule applied; they carry
no bespoke layout.

### Interaction principles

- **Latency:** every action acknowledges within 100ms — the control disables
  and states its work ("settling…"). Server work up to a few seconds is a
  named loading line, never a blank region.
- **Error:** the app shows what the database said. A failed call surfaces the
  function's own refusal in mono, plus the fix in the app's voice. Errors are
  never swallowed and never replaced with a generic message.
- **Emptiness:** an empty queue is good news and reads that way; an empty
  bucket, a table with no rows, and an unprovisioned table are three different
  states and never share a rendering.
- **Repeat use:** the operator sees these pages every morning. Nothing moves
  between visits, counts sit in fixed positions, and yesterday's link still
  works.

### Taste references

- **Linear** — density that stays legible, and every list state addressable
  by URL and reachable by keyboard.
- **Stripe Dashboard** — the object detail page: an entity, its raw fields and
  its history on one page, so an investigation ends where it started.
- **GitHub Actions run list** — a run diagnosed from its row: counts and the
  error summary inline, before you click anything.

---

## The Voice

**Register:** it talks like the pipeline's engineer reading you its own
logbook — plain, specific, no reassurance, no explaining of words this
operator already knows. *(VISION: "the app assumes a fluent operator, not a
newcomer")*

### Glossary — one name per concept, everywhere

| Use | Never | Why it is pinned |
| --- | --- | --- |
| **claim** | observation, assertion, datapoint | `observation_id` stays a machine id; the operator reads claims |
| **review item**, of kind **decision** or **signal** | task, ticket, alert, issue, escalation | the two kinds are the queue split; synonyms erase it |
| **verdict** | resolution, approval, judgement, vote | the verdict is a specific logged row |
| **override** | manual edit, correction, fix | an override is a verdict without an item |
| **cycle** (resolver) / **run** (adapter) | job, sync, task, batch | two different producers, two different tables |
| **bucket** | state, status, stage, category | a pending claim's classification |
| **tier** | level, rank, trust score, priority | a source's trust level; `admin` is the top |
| **canonical** | live value, current truth, production value | the value the resolver applied |

### Copy bars

1. **Every button is a verb plus its object, naming what gets written**:
   "Choose this value", "Keep current value", "Save override", "Link to venue",
   "Mark fixed", "Close as won't fix". Never "Submit", "Confirm", "Apply",
   "OK", "Save".
2. **An action keeps its name through the whole flow**: "Keep current value"
   settles to the state "kept current value" and logs the line "kept current
   value" — the word never changes between button, confirmation, and log.
3. **Every error names what failed, then what to do, with no apology** — no
   "Oops", "Sorry", "Something went wrong". "A won't-fix needs a note — say
   why the condition stands, then close it again" beats "Error: note
   required".
4. **Every empty and not-provisioned state names what the surface holds and
   what fills it.** Never a bare "No data" or "No items to display": "No open
   decisions — the resolver files one here when sources disagree." /
   "`verdicts` isn't in this database yet — it arrives with the scraper repo's
   migration."
5. **Sentence case everywhere; capitals only for names.** Machine identifiers
   (`data_conflict`, `admin_locked`, `event_performers`, `wont_fix`) render
   verbatim in mono and are never prettified into Title Case prose.
6. **Ages are relative, scheduled times are absolute, counts carry their
   noun**: "3d ago" (absolute in the title attribute), "2026-08-29 04:12 UTC"
   with the zone stated once in the column header, "12 open decisions" —
   never "Count: 12", never a raw ISO string in a scannable column.
