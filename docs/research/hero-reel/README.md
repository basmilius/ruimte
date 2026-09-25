# Hero reel

Twenty takes for the hero visual of ruimte.app, built into one page to choose from. Each take draws into a logical 560 x 500 box through `harness.js`; `BRIEF.md` is the contract and `SPECS.md` the direction for every take.

- `node build.mjs` writes `out/ruimte-hero-reel.html`, the page that is published as an artifact.
- `node shot.mjs <id> --t 1,4,8 --w 360` renders stills of one take with Playwright into `shots/`.

A take that is chosen is ported to TypeScript under `apps/site/src/components/hero`; nothing here ships.
