# Ben, 2026-09-16 (during the §7 acceptance walk): performers on an event's record page

Filed by the dispatcher verbatim from Ben's words in session.

> "I should be able to edit performers for an event. I was testing the monsta x veeps event and I don't see monsta x as a performer, but they should be and I should be able to add that."

Facts measured read-only on staging at the time: the event (MONSTA X CONNECT X, 01a09c5e-5d61-7440-9efe-790e5e9cc310) DOES carry an `event_performers` row linking group MONSTA X (7c1541a0-…); the record page simply does not draw performers — they are a link (event_performers), not a column of events, and the page's map draws only the mapped columns (BUG-0126's disclaimer). The pipeline already supports `events.performers` as a fact (`apply_resolution` fact key `performers`; Admin's decision.ts names the key). What is missing is the surface: show the linked performers on the event record page and offer a picker to add/remove them (same shape as the venue picker), through the override path.

Routing note: feature-level (a new control on an existing surface); Ben says it is not for this campaign — hold for the next campaign's intake or Ben's external-ticket route.
