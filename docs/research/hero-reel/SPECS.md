# The twenty takes

Every spec below is a direction, not a cage: keep the idea, the principles and the technique, and make
the details better where you see how. Titles and ids are fixed. The "line" is a draft; tighten it.

---

## room-in-a-room: Room in a Room
Principles: Staging, Slow in and slow out. Tech: Canvas 2D, logarithmic camera, recursive scene.
Line: Ruimte means room. Every node is a room, and every room holds a canvas.
A small Ruimte canvas: 4 or 5 nodes (terminal, chat, browser, note) on a faint neutral dot grid, joined
by curved edges. The camera dives into one node (say the browser or chat), whose content area *is* the
same canvas scene, which holds the same node, and so on: an endless Droste zoom that loops seamlessly
(the scene at level n+1 is exactly the scene at level n, scaled into the target node's content rect).
Rhythm: pose to pose, not constant: the camera dwells on a level for a beat (nodes alive: terminal lines
typing, a status dot pulsing, a chat bubble arriving), then dives with a strong slow-in/slow-out move
(about 1.6 s), and settles. Draw 3 or 4 levels deep so the inner room is always already there; the
outer level dissolves past the edges. Pointer: steers the camera slightly (parallax lean toward it).

## letterspace: Letterspace
Principles: Squash and stretch, Anticipation, Exaggeration. Tech: Canvas 2D, per-glyph springs.
Line: Ruimte is Dutch for space. So the word makes some.
The word "ruimte" set huge (Geist 600, lowercase, about 140 logical px) in text color. Beat 1: the
letters squeeze together slightly (anticipation), then spring apart, tracking opening wide; in each gap
a small piece of the product scales in on a spring (a blinking terminal block cursor, a status dot, a
tiny chat bubble, a browser address pill, a small edge between two dots). Beat 2: the letters slam back
together, squashing the objects out (they pop and vanish with a tiny particle puff); the letters
themselves squash on impact (scaleX up, scaleY down around the baseline) and wobble back. Beat 3: a
wave runs through the word (each glyph hops in turn with stretch on the way up, squash on landing); the
dot of the i pops off like a ball, bounces once and lands back, in the accent blue, the only accent.
Measure each glyph with measureText so spacing is correct. Pointer: glyphs near the pointer lean and
slide away from it, making room around the cursor.

## patch-bay: Patch Bay
Principles: Follow through and overlapping action, Secondary action. Tech: Canvas 2D, Verlet ropes.
Line: Draw a line to share context. Every connection is a real cable.
Four compact nodes (chat "claude", terminal "zsh", browser "localhost:3000", note "brief") floating
with a slow bob, each with one or two ports (small sockets on the node edge). Cables are Verlet ropes
(about 18 to 24 points, gravity, 6 to 10 constraint iterations) drawn as a thick soft tube with a
narrow highlight, in the context-edge color (accent mixed into the ground) and one in amber. A phantom
cursor (a small arrow with a label pill "claude") picks up a free plug, carries it on an arc to another
node's port; the plug snaps in with a short flash, the port lights, the target node gives a small
spring pulse, and the cable swings and settles. Later it unplugs a different cable and re-patches.
Nodes bob, so cables keep swaying (secondary action). Pointer: pushes rope points like a finger; while
`down`, grabs the nearest rope point.

## split-flap: Split-Flap
Principles: Timing, Follow through and overlapping action. Tech: Canvas 2D, mechanical flap cascade.
Line: Every session on one board. It flips when an agent needs you.
A Solari departure board: 5 or 6 rows of split-flap characters, columns: agent (CLAUDE, CODEX, ZSH),
task (REFACTOR AUTH, FIX FLAKY TEST, BUILD SITE, TRACE CHECKOUT, NPM RUN DEV), status (RUNNING,
NEEDS YOU, DONE) with a small lamp per row in the status color (amber lamp pulses). Every ~2 s one row
updates: its characters cycle through the drum (blank, A to Z, 0 to 9, a few symbols) to the new
text, a cascade from left to right with a slight random stagger. Each flip is mechanical: the top half
of the old character falls (foreshortened, darkening as it turns), revealing the top of the next,
while the falling flap becomes the bottom half; the flap lands with a small bounce (follow-through)
and a tiny rattle. Flaps are raised dark cards with a hairline split, subtle top-lit gradient, mono
bold characters (JetBrains Mono 700) in off-white. The whole board sits with calm depth (a soft shadow,
maybe a slight perspective). Pointer: hovering a row makes that row flip to its next message.

## floating-rooms: Floating Rooms
Principles: Solid drawing, Staging. Tech: WebGL, SDF raymarching, soft shadows.
Line: A quiet, lit volume with room for every window.
A raymarched scene: five to seven thin rounded slabs (like window panes or cards) floating at
different depths and angles, slowly bobbing and turning, rearranging over a long cycle. Material: dark
glossy (surface #18181c-ish), a Fresnel rim in cool white, one or two slabs with a thin accent-blue
emissive edge, faint "screen" content on the front faces (procedural rows of text-like bars,
a status dot). A soft key light from the upper left, soft shadows between slabs, gentle fog into
transparency with depth. No floor; alpha comes from hits, with a soft edge. Camera orbits slowly;
the pointer orbits it further. Keep it to ~64 steps and bounding checks so it runs at 60 fps.

## making-room: Making Room
Principles: Slow in and slow out, Staging. Tech: Canvas 2D, power diagram with Lloyd relaxation.
Line: There is always room for one more. Open a node and the rest make space.
Nine to thirteen cells tessellate a soft rounded region (circle or superellipse), each cell a rounded
pane (inset gutter ~6 px, rounded corners via arcTo) in surface color with a hairline border, a tiny
glyph for its kind (terminal `>_`, chat bubble, globe, note lines) and a status dot. Cells are a
weighted Voronoi (power diagram) of moving seeds, relaxed toward their centroids each frame (Lloyd).
Cycle: a new seed appears with a pulse, its weight grows so its cell inflates, the neighbors ease
aside; later an old cell's weight shrinks until it closes and the rest fill in. Everything eases,
nothing snaps. Pointer: acts as a seed of its own (an empty, outlined cell with a subtle label "you")
that pushes the others aside.

## cursor-flock: Cursor Flock
Principles: Arcs, Secondary action. Tech: Canvas 2D, boids steering with target morph.
Line: Agents with cursors of their own, so yours stays free.
About 40 small arrow cursors (a proper macOS-style pointer path, white fill with a dark outline, a few
tinted in status colors), some with tiny label pills ("claude", "codex", "agent 3"). They flock
(separation, alignment, cohesion), banking along their heading with smooth arcs. Cycle: flock for a
while, then glide into formation, outlining the Ruimte mark (two overlapping rounded parallelograms)
with arrival easing and a stagger; hold; every cursor "clicks" (a small press and a ripple ring), then
the formation bursts back into the flock. Pointer: the flock parts around your cursor and a few curious
ones orbit it.

## ball-test: The Ball Test
Principles: Squash and stretch, Arcs, Timing. Tech: Canvas 2D, onion skinning and spacing charts.
Line: Every animator starts with a bouncing ball. Ours checks in on your agents.
Four compact node title bars on a staircase of heights. A ball (a status dot scaled up to about 22 px)
bounces from node to node on clean parabolic arcs: stretched along its velocity in flight, squashed on
impact, anticipation (a crouch) before the big jump. Each landing: the node dips on a spring, its status
dot takes the ball's color (running, needs you, idle), the ball takes the next color. Show the craft:
onion skin (the last several poses at fading alpha) and a faint dotted spacing chart along the arc
(ticks at equal time steps, so you see the spacing tighten at the top and open at the bottom), plus a
small timing chart label in mono ("12f", "8f"). Loops seamlessly. Pointer: nodes lean toward it and
the ball's jumps adapt.

## transit: Transit
Principles: Slow in and slow out, Staging. Tech: Canvas 2D, path choreography with arc-length.
Line: Worktrees branch off, do their work and merge back, on time.
A transit diagram: thick lines (6 px, round joins), horizontal and 45 degree segments only, with
rounded corners. A neutral "main" line runs across; branch lines in status/ANSI colors split off,
run parallel, and merge back. Stations: white dots with a dark ring; interchanges as pills. Small mono
labels: "main", "fix/flaky-test", "feat/saved-carts", "agent/trace". The map scrolls slowly to the
left forever (time moving), new branches draw themselves on at the right (stroke reveal from the
split), trains (small rounded capsules) run along them with real acceleration and braking between
stations and a brief dwell, and a merge station pulses when a branch joins main. Old branches slide
off the left edge. Pointer: hover pauses the scroll into a slow drift and highlights the nearest line.

## loupe: Loupe
Principles: Squash and stretch, Appeal. Tech: WebGL, SDF refraction, chromatic aberration.
Line: Follow the work. Everything is in focus where you look.
A dense little Ruimte canvas (many small nodes, edges, text lines) drawn once to offscreen canvases (a
sharp one at 2x and a blurred, dimmed one via ctx.filter blur) and uploaded as textures. The ground
shows the blurred version. A liquid-glass lens (a rounded square or superellipse, ~150 logical px)
glides over it along a slow Lissajous path, showing the sharp version magnified ~1.5x with refraction
bending strongest at the rim, slight chromatic aberration at the edge, a Fresnel highlight and a
specular streak. The lens squashes and stretches with its velocity (stretches along the direction of
travel, settles round when it stops) and wobbles like liquid when it stops. Some content animates
(status dots, a progress bar) by redrawing a small region or a second texture. Pointer: the lens
follows the pointer with a springy lag.

## resonance: Resonance
Principles: Timing, Slow in and slow out. Tech: Canvas 2D, 6000 grains, Chladni modes.
Line: Find the right frequency and noise settles into structure.
Grains of sand (about 6000 at quality 1, tiny light dots, drawn by writing pixels or small rects) on an
invisible square plate. Each grain moves down the gradient of the plate's vibration amplitude
|f(x, y)| plus jitter proportional to the local amplitude, so grains shake loose where the plate moves
and settle on the nodal lines. f = cos(n pi x) cos(m pi y) - cos(m pi x) cos(n pi y). The mode changes
every ~5 s through a pleasing sequence; at each change a kick scatters the grains (a quick jump), a
faint ring pulses out from the center, then they flow into the new figure. A faint mono label "n 3 m 5"
in a corner. Grains are neutral warm white, a few in accent. Circular soft edge. Pointer: a finger on
the plate: grains flee it.

## shuffle: Shuffle
Principles: Follow through and overlapping action, Arcs, Anticipation. Tech: Canvas 2D, spring choreography.
Line: Terminals, chats and browsers, dealt the way you want them.
Six or seven window cards, each a real miniature (terminal with colored lines, chat with bubbles,
browser with an address bar and page blocks, a yellow note, a diff with red and green lines, a plan
checklist). A choreographed loop of about 12 s: neat stack; fan out into an arc like a hand of cards,
staggered; a riffle shuffle (two halves interleave with a cascading arc); a deal into a 3 x 2 grid (the
app's grid view), every card flying on an arc, landing with overshoot and a settling rotation; a
hold where the cards come alive (dots pulse, terminal types); a gather back into the stack with a swoop.
Rotation leads the motion, shadows grow with lift, nothing moves on a straight line. Pointer: the card
under the pointer lifts.

## napkin: Napkin
Principles: Straight ahead and pose to pose. Tech: Canvas 2D, stroke reveal and point morphing.
Line: Sketch it and the agent reads it, in the order you meant it.
A hand-drawn diagram: three or four wobbly boxes (double-stroked, rough, like a marker on a napkin)
labeled in Kalam ("web", "api", "db", "queue"), hand-drawn arrows. It draws itself stroke by stroke,
straight ahead, with a pen tip, each stroke fast in the middle and slow at its ends, in the order a
person would draw. Hold. Then pose to pose: each rough box morphs into a crisp Ruimte node (points
interpolate from the jittered outline to a clean rounded rect, a title bar appears, staggered), the
arrows straighten into smooth edges with a flowing dot, Kalam labels cross-fade into sans labels. Hold,
then the nodes dissolve back into chalk and the sketch is wiped with a quick eraser sweep, ready to
draw again (a different variant each cycle is a bonus). Pointer: the pen tip follows the pointer while
drawing, leaving a faint scribble.

## monospace: Monospace
Principles: Solid drawing, Timing. Tech: Canvas 2D, CPU raymarching into a character grid.
Line: A terminal is a canvas too. This one draws the mark in 3D, one glyph at a time.
A terminal window (terminal bg, a minimal title bar "zsh  ruimte render"). Inside, a grid of about 60
x 28 monospace cells renders a rotating 3D object by raymarching per cell and mapping brightness to a
ramp like " .,:;=+*#%@": the Ruimte mark as two thick rounded parallelogram slabs, rotating, which
later morphs (SDF blend) into a torus and back. Characters are colored: the dark slab tinted in ANSI
blue, the light slab off-white. A first line "$ ruimte render --mark", a blinking block caret at the
bottom, and a frame counter in dim text. When the shape changes, cells scramble briefly through random
glyphs before settling (a decode). Pointer: rotates the object.

## mitosis: Mitosis
Principles: Squash and stretch, Staging. Tech: WebGL, metaballs with smooth minimum.
Line: One agent becomes a team, and the team comes back with one answer.
A metaball field (smooth-min union of up to ~12 circles) rendered as dark glossy goo with a cool rim
light and a specular highlight. One large blob (the agent) pulses, then divides like a cell: it
stretches, pinches at the waist and separates with a gooey neck into two, which divide again into a
small tree of four; small packets travel between parent and children. Each child's rim goes from
running blue to done green as it finishes, then the children flow back and merge into the parent
(squash and stretch on contact), which answers with one bright ring. Small mono labels ("trace",
"query", "report") fade in beside the children (2D, drawn on top). Pointer: the goo leans toward it.

## in-step: In Step
Principles: Timing, Arcs. Tech: Canvas 2D, harmonic motion in 3D projection.
Line: Twenty sessions, each on its own clock, falling into step.
A pendulum wave: 15 to 20 pendulums hanging from one bar, each with a slightly different period so
that together they make traveling waves, split into two and three groups, go chaotic and come back
into one line every ~30 s (a loop). Seen in perspective at an angle so the swing reads as a snake.
Bobs are small glowing status dots; the string is a hairline; a faint arc trail shows the recent
path. Pointer: rotates the view.

## phosphor: Phosphor
Principles: Arcs, Timing. Tech: Canvas 2D, beam persistence with speed-weighted brightness.
Line: One clean signal draws the mark, the word, and back.
An oscilloscope vector display: one beam traces a path quickly and the phosphor fades (a persistence
buffer that decays each frame). Brightness per segment is inversely proportional to beam speed, as on a
real scope (slow means bright). The sequence morphs between shapes, all resampled to the same number of
points: Lissajous figures (3:2, 5:4) turning, the Ruimte mark (two rounded parallelograms, one path),
the word "ruimte" in a single-stroke script you design from polylines, back to Lissajous. Color: a
blue-white beam core with a blue glow. A faint graticule (10 x 8 divisions, minor ticks) and mono
labels ("2 ms/div", "0.5 V/div"). Pointer: acts like the two frequency knobs while a Lissajous shows.

## overnight: Overnight
Principles: Staging, Timing, Appeal. Tech: Canvas 2D, illustrated keyframe story.
Line: Close the window at night. In the morning the work is where you left it.
A small illustrated story in a round porthole. A laptop (clean flat illustration, 3/4 view) with a
terminal running tests. Evening: the lid closes (hinge rotation with ease and a tiny bounce), the
screen's light spill goes out. Night: time-lapse, the sky darkens, stars wheel, a small machine glyph
(the daemon) keeps blinking, a clock or counter ticks ("02:14", "312 tests"). Morning: warm light
rises, the lid opens and the terminal shows exactly where it was, plus more output ("1284 passed"),
caret blinking. About 14 s, seamless. Pointer: tilts the scene slightly.

## interference: Interference
Principles: Timing, Appeal. Tech: WebGL, analytic lattices with anti-aliasing.
Line: Two machines, one project. Where their grids meet, patterns appear.
Two dot lattices (fine pitch) overlaid in a circle; one rotates slowly and breathes in scale against the
other, making moire rosettes that bloom and dissolve. Later one lattice turns hexagonal for a different
figure, and a soft radial lens warps one lattice so the moire blooms in a ring. Dots neutral white at
low alpha, anti-aliased with fwidth; the figure is the moire itself. Pointer: warps the top lattice
around the cursor, so the pattern flowers where you point.

## flipside: Flipside
Principles: Follow through and overlapping action, Appeal. Tech: Canvas 2D, lattice of 3D flips.
Line: The mark, multiplied: a field of planes that turn to show both sides.
The app icon's rounded parallelogram tessellates the box in a lattice. Every tile has two faces: the
icon's dark navy and its pale grey. Tiles flip in 3D around their long axis (foreshortened, darker
edge-on, a specular sweep crossing the face) in waves: a ripple from a point flips the field to light;
a second wave leaves exactly the two big parallelograms of the logo in the middle (built from tiles);
then random staggered flips dissolve it. Overlap: neighbors start a little later and settle with a
slight overshoot. Soft edge fade. Pointer: tiles near the pointer tilt toward it like a field of
magnets. This is the end card of the reel: it resolves into the mark.
