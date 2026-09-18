# Native parity fixtures

The JSON oracle fixtures in this directory were captured during the migration from `3b46403` through `main@09fa3976` and checked against the synchronized TypeScript implementation before it was removed. Native Rust tests consume the checked data directly. Generators that imported daemon internals were removed with that implementation, so their outputs are historical compatibility records rather than regenerated snapshots. Shared-contract and xterm generators remain active.

`usage-summary-expected.json` contains normalized `usage.summary` replies from the same TypeScript revision. Paths and project ids use stable placeholders; scan timestamps and durations are omitted because they depend on the run.
