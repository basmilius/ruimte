# Ruimte intro film: brief for every variant

We are making four variants of a one-minute introduction film for Ruimte. Each shows the important agentic
features, on the infinite canvas and in other views, through one story: building the website for a festival.
The person choosing will pick one (or parts of one) to put on ruimte.app and to share. Every variant has to be
good enough to be that one.

Read first: `BRIEF.md` (the look, the palette, the type, the rules of the reel; they all apply),
`SPECS2.md` (the product facts at the top: get every one right), `harness.js`, `film.js`. Study how the
product looks in `/home/user/ruimte/apps/site/src/components/` (app/, features/, film/) and in the roll B takes
in `pieces/` (needs-you, question-card, grid-views, attention-stack, infinite-canvas, wake-chain, delegation,
plan-tree, limit-clock, agent-loop, context-lines, stream, reading-order, voice, three-ways, handshake,
phantom-cursor, device, browser-drive, mission-control), which already draw the product faithfully.

## The contract

One file, `films/<id>.js`:

```js
Film.define({
    id: 'night-before',
    title: 'The Night Before',
    duration: 60,
    create(v) {
        // v.ctx (2D, 1920 x 1080, filled with the ground before each frame), v.W, v.H, v.R (the reel helpers),
        // v.fps (30), v.rand, v.take(id, { width, options }) to place a reel take.
        return {
            draw(t, dt) {} // called for every frame in order, t = frame / 30
        };
    }
});
```

- `v.take(id, { width, options })` returns an off-screen take you advance yourself (`take.tick(dt)`, or
  `take.seek(time)` to jump), steer (`take.point(x, y, active)` in its 560 x 500 box) and place
  (`take.draw(ctx, x, y, w, alpha)`; height is w * 500 / 560). Takes are transparent with soft edges, so they
  sit on the ground. Only tick a take while it is on screen or about to be.
- The wordmark is the letterspace take with a capital R: `v.take('letterspace', { width, options: { word:
  'Ruimte' } })`. Its own loop squeezes, opens with product pieces in the gaps, slams shut, waves; pick the
  stretch you need with seek and tick. You may instead copy its code into your film and drive it yourself.
- You may copy any code from `pieces/` into your film to build full-frame scenes (16:9 compositions look
  better than a take pasted in the middle). Do not edit shared files (harness.js, film.js, film.html,
  film-render.mjs, pieces/, other films).

## The festival (the same in every variant)

- **Nachtveld**, a three-day summer festival, 14 to 16 August. Two stages, **Veld** and **Bos**. The site has
  three pages: line-up (`/lineup`), tickets (`/tickets`), map (`/map`). The project is `nachtveld-web`.
- The lead agent is a Claude chat, "Launch the Nachtveld site". It delegates to three agents: "Line-up page",
  "Ticket shop", "Festival map", each in its own worktree with its own plan. Codex runs the tests in a terminal.
- A question from an agent: "Sell day tickets, or weekend only?" with options "Day and weekend", "Weekend
  only", "Something else...". An approval: "Allow deploy to production?".
- Machines: "studio" (the Mac), "build-box" (a Linux server running `npx ruimte`), and the person's iPhone.
- Text in the film is American English, no em or en dashes. Invent nothing about the product that SPECS2.md
  or the site does not say.

## Look and craft

- 1920 x 1080 at 30 fps, silent (it autoplays muted on the site): every feature is legible without sound.
  A short lower-third caption names each feature as it appears (Geist 500 around 30 px, text color, one line,
  fades in and out, never more than about seven words, for example "Agents ask. You decide."). Big title
  cards only at the start and the end.
- Open on the Letterspace wordmark (Ruimte) and end on a card: the wordmark, "Space for AI Engineering." and
  "ruimte.app".
- Cinematography: one idea per shot, a clear focal point, strong slow-in and slow-out on every camera move,
  match cuts and continuous moves over hard cuts where you can, overlap between shots, nothing popping in.
  The same principles as the reel, now across a minute: timing and staging carry the film.
- UI must look exactly like the product (node chrome, status colors, prompt cards, the grid of views,
  sidebar), crisp at 1080p. Text people should read stays on screen long enough (about 2 seconds for a line).
- Ground `#0d0d10`, accent `#155dfc` used with intent, status colors for status only.

## Tools

```
node film-render.mjs <id> --stills 2,6,10,14,...     # contact sheet of frames at those seconds -> renders/<id>-stills.png
node film-render.mjs <id> --from 20 --to 26 --scale 0.5   # a short clip to check motion -> renders/<id>-600-780.mp4
node film-render.mjs <id>                             # the full film, 1080p H.264 -> renders/<id>.mp4
```

Look at stills with the Read tool. Rendering uses a software renderer, so a full film takes several minutes;
use stills while you work and render the full film once at the end. Keep a frame cheap (no per-frame
allocation storms; embed only the takes a shot needs).

When done, reply with a short report (under 300 words): the shot list with timings, which features appear,
the render path, and anything you are unsure about.
