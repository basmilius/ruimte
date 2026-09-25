# Ruimte hero reel: brief for every take

We are making twenty new hero animations ("takes") for ruimte.app, shown together on one page like a
motion designer's showreel. The person choosing will pick one to ship in the hero, to the right of the
headline "Space for AI Engineering." on a near-black page. Each take has to be good enough to be that
one. It also has to prove a craft: every take names two or three of Disney's twelve principles of
animation, and the motion has to show them unmistakably. Think of it as a CV where each entry is a
piece of motion.

## What Ruimte is (the subject of every take)

Ruimte (Dutch for "space" and "room") is a desktop app: terminals, coding agents (Claude Code, Codex)
and browsers as nodes on one infinite canvas with a dot grid. You draw a line between nodes to share
context. Agents delegate to other agents (teams), ask you questions on the canvas, show a plan. Status
per node: running (blue), needs you (amber), idle/done (green), error (red). Sessions keep running on
your machine when the window closes. Connect other machines and your iPhone. Sketch boxes and arrows
and the agent reads the drawing. An agent can use a Mac app with a cursor of its own (a "phantom
cursor"), so yours stays free. The app icon is two rounded parallelograms (skewed squares) that
overlap: a dark navy one up-left and a pale grey one down-right.

## The contract

A take is one file, `pieces/<id>.js`, that calls `Reel.add({...})`. Read `harness.js` once; it is short.

```js
Reel.add({
    id: 'patch-bay',
    title: 'Patch Bay',
    line: 'One short sentence: what this take says about Ruimte.',
    principles: ['Follow through and overlapping action', 'Secondary action'],
    tech: 'Canvas 2D, Verlet ropes',
    hint: 'Move to pluck the cables',   // shown on hover; start with a verb
    poster: 6.5,                         // a time in seconds that makes the best still frame
    create(env) {
        // set up once; return the instance
        return {
            update(t, dt) {},   // optional: simulation only, no drawing. dt is at most 1/20 s.
            draw(t) {},         // required: draw the whole frame for time t (seconds since start)
            resize() {},        // optional: the canvas changed size (buffers were cleared)
            destroy() {}        // optional
        };
    }
});
```

Principle names, use exactly these strings: `Squash and stretch`, `Anticipation`, `Staging`,
`Straight ahead and pose to pose`, `Follow through and overlapping action`, `Slow in and slow out`,
`Arcs`, `Secondary action`, `Timing`, `Exaggeration`, `Solid drawing`, `Appeal`.

`env` gives you:

- `env.ctx`: the 2D context, already transformed so you draw in a **logical 560 x 500 box** (y down),
  whatever the real size is (a 280px tile or a 700px stage, at 1x or 2x). Never read `canvas.width`
  for layout; use `env.W` and `env.H` (560, 500). `env.scale` is physical pixels per logical unit, for
  when you need crisp 1-device-pixel lines (`lineWidth = 1 / env.scale`).
- `env.clear()`, `env.fadeEdges(inner, outer)`: the canvas is **transparent**; it sits on the page's
  own dark background (a faint blue radial glow, like the real site). Never paint a solid background
  rectangle. Content has to dissolve before it reaches the edges of the box; `fadeEdges` applies an
  elliptical `destination-in` mask to whatever is drawn so far (call it last). A box edge that shows is
  a bug.
- `env.pointer`: `{ x, y }` smoothed logical position, `tx, ty` raw target, `nx, ny` in -1..1,
  `active` 0..1 (eases in while the pointer is over the take, back to 0 after it leaves; when it leaves
  x/y drift back to the center), `inside`, `down`. Every take reacts to the pointer in a way that fits
  its idea, and still looks complete and alive with no pointer at all (most people will never hover).
- `env.quality`: 1 on the big stage, about 0.55 on the small tiles. Scale particle counts with it.
- `env.rand`: a seeded random (same sequence on every instance), `env.R`: helpers (below).
- `env.buffer()`: an offscreen `{ canvas, ctx }` at the take's resolution with the logical transform set.
  For trails and persistence. Composite with `env.ctx.drawImage(buffer.canvas, 0, 0, env.W, env.H)`.
- `env.shader(fragSource)`: returns `{ draw(uniforms, composite) }`. The harness owns one WebGL1
  context shared by all takes; `draw` renders your fragment shader over the whole box and copies it onto
  your 2D canvas (you can draw 2D on top afterwards). The prelude gives you `precision highp float`,
  `u_res` (physical px), `u_time`, `u_scale`, `u_pointer` (vec4: logical x, logical y, active, inside),
  `FC` (fragment coord relative to your box, px, y up) and `vec2 logical()` (560 x 500, y down).
  Output **premultiplied** alpha: `gl_FragColor = vec4(rgb * a, a)`. Uniform values: numbers, arrays
  (flattened for vec arrays), or a canvas for a `sampler2D` (`{ canvas, dirty: true }` re-uploads it
  that frame). Textures are uploaded flipped, so `texture2D(tex, FC / u_res)` is upright. WebGL1 GLSL:
  loops need constant bounds. `OES_standard_derivatives` is enabled (`fwidth`).

`env.R` (also on `Reel.R`): `W H TAU clamp lerp invlerp smoothstep fract mod dist phase(t,start,dur)`,
`ease.*` (linear, in/out/inOut Quad Cubic Quart Quint Sine Expo, inBack/outBack/inOutBack(t, s),
outElastic, outBounce, smoother, `bezier(x1,y1,x2,y2)` returning a function), `rng(seed)`, `hash(n)`,
`noise(x,y,z)` (Perlin, -1..1), `fbm`, `Spring` (`new R.Spring(v, {stiffness, damping, mass})`,
`.target`, `.step(dt)`, `.x`, `.v`), `pal` (colors, below), `rgba(hex, a)`, `mix(hexA, hexB, t, a)`,
`vec3(hex)` (0..1 floats), `fonts.display|sans|mono|hand`, `roundRect(ctx, x, y, w, h, r)` (a path).

## Look

- Ground: the site is `#0d0d10`. Palette, from the site's tokens (`R.pal`): surface `#131316`, raised
  `#18181c`, sunken `#08080a`, hover `#202024`, text `#ececf1`, muted `#9a9aa6`, faint `#5f5f6b`,
  accent `#155dfc` (the one brand blue; use it with intent, not everywhere), status running `#60a5fa`,
  needs you `#fbbf24`, idle `#4ade80`, error `#ef4444`, ANSI magenta `#c084fc`, cyan `#67e8f9`,
  terminal bg `#08080a`, terminal fg `#d6d6de`, note `#3b3416`, the icon's planes `markDark #1c2233`,
  `markLight #d9dee6`. Borders are white at 7% or 13% alpha, never a gray of their own.
- Type: `R.fonts.display` is Geist (the site's headline face), `mono` is JetBrains Mono, `hand` is Kalam
  (only for hand-drawn text). Weights loaded: Geist 400/500/600/700, JetBrains Mono 400/500/700, Kalam
  400/700. Canvas text uses them directly: `ctx.font = '600 40px ' + R.fonts.display`.
- A node on the Ruimte canvas looks like: a rounded rect (radius ~8 logical px) in surface `#131316`,
  a hairline border white 7-13%, a title bar ~24px tall with a small kind glyph, a title in 12-13px
  sans/mono muted text, and a status dot at the right. Terminals are `#08080a` inside with mono text.
  Edges between nodes are smooth curves; a context edge is the accent mixed into the ground at ~55%.
- Never highlight a dot grid in the accent blue (a product rule): dots stay neutral gray/white.
- No em dashes or en dashes in any text you draw. American English. No emoji.
- Restraint: a hero visual supports a headline. Keep the mass of the image in the box, calm edges, one
  clear focal point, a readable silhouette at 280px wide. Premium, precise, quiet confidence; the wow
  comes from motion quality (spacing, arcs, overlap, weight), not from clutter or neon.
- Loops: every take runs forever. Either it is a steady state, or its sequence loops seamlessly (plan the
  cycle; no visible jump at the wrap). A cycle between 8 and 20 seconds is typical.
- Reduced motion: the page shows the take frozen at `poster`, reached through `update` steps and one
  `draw`. Choose a poster time that reads as a finished picture.

## Budget

A frame of your take must stay light: the page runs one big stage plus six to eight tiles at once. Aim
for under 4 ms per frame on the stage at quality 1 in a normal browser (the bench below runs on a
software renderer, so its number is only relative: keep it under ~25 ms at 560px for 2D takes). No
allocation-heavy code in the hot path (reuse arrays, avoid creating gradients per particle). Shader
takes: at most ~64 raymarch steps, keep it simple enough for an integrated GPU at 1400 x 1250.

## Test it

```
node shot.mjs <id> --t 1,4,8,12 --w 360        # a strip of stills at those times -> shots/<id>.png
node shot.mjs <id> --t 5 --w 560 --p 400,200    # one frame with the pointer at logical 400,200
node shot.mjs <id> --t 2 --w 560 --bench         # adds ms per frame
```

Then look at the PNG with the Read tool. Errors print to the terminal. Stills cannot show motion, so
think the motion through in code (easing, spacing, overlap), and use a few strips at close times
(e.g. `--t 3.0,3.1,3.2,3.3`) to check a key moment. Do a handful of looks per take, not dozens.

## Rules for the code

- Plain browser JavaScript, no imports, no libraries. Everything inside the `create` closure.
- Deterministic: use `env.rand` / `R.hash` / `R.noise`, never `Math.random`, so the stage and the tile
  of the same take match and a poster is stable.
- `draw(t)` must produce the same frame for the same state; time-based choreography should be a pure
  function of `t` where possible. Simulations advance in `update(t, dt)` only.
- 4-space indent, curly braces always, no one-letter variable names except `i`, `e`, `x`, `y` (loop
  counters `j`, `k` are fine too), comments only for WHY.
- Do not touch `harness.js`, `test.html` or other people's files. If the harness is missing something,
  work around it inside your take and mention it in your report.
