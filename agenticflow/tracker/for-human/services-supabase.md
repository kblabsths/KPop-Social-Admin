Declare the staging Supabase project in agenticflow/docs/SERVICES.md as a `## supabase` section (console URL, tier, the staging project ref agents may touch, provisioned-by/date). The remote gate refuses any undeclared service CLI, so without this entry agents cannot run direct SQL on staging for the parity checks.
Recommend: declare it now; the architect will say separately if a DB connection-string NAME is also needed for direct-SQL parity.
Unblocks: acceptance tests 2–3 (parity against direct SQL) and 13 (live-suite residue sweep).
