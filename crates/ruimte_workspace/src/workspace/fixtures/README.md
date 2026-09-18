# Workspace parity fixtures

`canvas-help-oracle.json` and `workflow-oracle.json` were captured during the migration from `3b46403` through `main@09fa3976` and checked against the synchronized TypeScript implementation. Their generators imported daemon internals and were removed with that implementation.

The diagram, drawing, render and plan generators use shared packages rather than daemon code and remain reproducible.
