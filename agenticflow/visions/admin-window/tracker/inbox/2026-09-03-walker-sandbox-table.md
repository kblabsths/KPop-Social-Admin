# Walker sandbox table (from Ben, 2026-09-03, relayed verbatim by the dispatcher)

> I don't think walkers should be editing staging tables. groups/idols is an
> exception but ideally we make a test table that walkers can interact with
> through the ui. [...] I would say that we should just create a table that
> always exists which walkers can interact with. After a walk it should be
> reset for the next walk.

Context for routing:
- The table itself is a schema change, so it is a scraper-repo migration
  (handoff; a campaign runs there now). Admin's side is an `EDIT_CONFIG`
  entry exposing its vetted scalar columns (ideally one of each edit type:
  text, integer, boolean, date, nullable) plus a kit-side reset that
  truncates and reseeds it from a fixture before/after each walk.
- Until it exists, walkers use the groups/idols exception: one field on one
  existing row, original noted, restored before the walk ends, residue sweep
  after.
- Not M1 scope; the M1 endgame proceeds on the exception.
