# Allowed dependencies

Sole writer: the **toolsmith** (via DEP tickets). The supply-chain hook blocks
every install not listed here. Entry format, one per line:

`- <exact-name> (<version-range>) — <one-line purpose> [vetted <date>, DEP-XXXX]`

On an existing codebase the toolsmith's first invocation seeds this file from
the shipping dependency manifest(s), each entry marked `(grandfathered)`.
Manifest-driven managers are allowlisted by manager name: `cocoapods`,
`gradle`, `swift-pm`.

## (empty — seeded at intake)
