# Blocked dependencies — human-only tier

Checked by the supply gate BEFORE the allowlist, and it wins. No agent may
edit this file (the toolsmith proposes entries in ticket notes; only you add
them). Use it for packages that must never be installed even by mistake:
typosquats of your real dependencies, phone-home tooling, anything a
compromised vetting should not be able to readmit.

Entry format: `- <exact-name>  # why`
