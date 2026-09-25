# Roll B: twenty agentic takes

Roll A (SPECS.md) was about space, craft and abstraction. The person choosing wants roll B closer to what
Ruimte actually is: a place where you run and steer AI agents. Every take here shows one real Ruimte
feature or one real moment of agentic work, so that someone who has never heard of Ruimte understands
something true about it from the hero alone. Still a hero: calm, one focal point, premium, readable at
280px, alive without a pointer, soft edges. Same contract, look and rules as BRIEF.md.

Look at the real thing before you draw it. The site already redraws the app in React, with the client's
own measures: read `/home/user/ruimte/apps/site/src/components/app/` (chrome, chat, bodies, canvas,
primitives, drawing, edge-route) and the vignettes in `/home/user/ruimte/apps/site/src/components/features/`
and `/home/user/ruimte/apps/site/src/components/film/` (phantom cursor). Match their node chrome, radii,
paddings, status dots, prompt cards and edges, so these takes look like the product and not like a
generic dashboard. Product facts are in `/home/user/ruimte/CLAUDE.md` (read "Product rules").

Facts to get right:
- Status colors: running blue `#60a5fa` (the "working" words shine), needs you amber `#fbbf24`, idle or
  done green `#4ade80`, error red `#ef4444`. A chat that waits on a person says so on every client.
- Chats run Claude Code and Codex; any other CLI runs in a terminal node. Agents change the canvas only
  through `ruimte-context <verb>` (read, answer, done, browser, device, computer, agent).
- A finished task wakes the chat that delegated it, once. A child that waits on a question leaves its
  parent a note after 15 seconds and does not wake it. A child that hits a usage limit pauses its task,
  says when the limit lifts, and resumes at the reset only if a person turned that on.
- Context is shared by drawing a line between nodes; the agent reads what is on the other end.
- A question from an agent is a prompt card on the canvas with options and your own answer; arrow keys
  move, Enter picks. Approvals are answered from the app or the iPhone.
- Views live in a sidebar; up to 3 x 3 views open at once in a grid.
- Worktree agents work in their own worktree; a merge conflict is resolved in an overlay from the three
  versions (base, ours, theirs), stretch by stretch; an agent may propose a stretch, a person accepts.
- Machines pair once with ed25519 keys; the broker relays signals between keys and never reads an
  envelope; then a direct channel opens. Your iPhone and station.ruimte.app reach any machine.
- Computer use: an agent operates a Mac app with a phantom cursor of its own, a session bar shows it,
  the person pauses with Option-Space and takes over.
- A browser node is driven by address only: where the page goes, its history, a picture of it.
- A drawing is read by the agent in the order you meant it.
- Voice: dictation previews text and inserts only after you stop; into a terminal it becomes a draft.

---

## E: product choreography

### needs-you: Needs You
Principles: Staging, Anticipation. Tech: Canvas 2D, attention choreography.
Line: Twelve agents at work. You only look at the one that waits for you.
A zoomed-out canvas with about twelve compact chat and terminal nodes, all quietly working (blue dots,
tiny shimmering "working" lines, a few terminal lines scrolling). One node turns amber: a small
anticipation pulse, then the staging: the rest dims and settles back, the camera eases toward it, and a
prompt card grows out of the node (question plus two or three options). A cursor picks an option, the
card folds back into the node, the node goes blue, the canvas returns. Next cycle another node asks.

### question-card: Your Call
Principles: Anticipation, Slow in and slow out. Tech: Canvas 2D, UI micro-interactions.
Line: The agent asks. You decide. It carries on with your choice.
One chat node large in frame. The agent's message streams in ("Saved carts: how long should they
last?"), then a prompt card unfolds with options staggered in ("7 days", "30 days", "Until checkout",
"Write your own"). The selection highlight glides between options (arrow keys shown as tiny key caps),
a press on Enter (the key cap squashes), the chosen option pulses, the card collapses into a one-line
answer bubble and the agent resumes working (shine text). Micro-interactions done perfectly.

### grid-views: Three by Three
Principles: Follow through and overlapping action, Timing. Tech: Canvas 2D, tiling layout springs.
Line: Open up to nine views at once. Every one keeps running.
A sidebar of views (rows with icons: canvas, chat, terminal, browser, drawing) at the left, a grid area
at the right. Views fly from the sidebar into the grid one by one: 1, then 2 side by side, then 2 x 2,
then 3 x 3; each change re-tiles every cell with springs (overlap: cells arrive a few frames apart,
content inside lags a touch behind its frame). Each cell keeps its content alive the whole time (a
terminal scrolling, a chat streaming, a browser loading). Then it collapses back to one.

### attention-stack: The Stack
Principles: Follow through and overlapping action, Arcs. Tech: Canvas 2D, card stack physics.
Line: Whatever needs you lands on one stack, in the order it came.
The stack card of Ruimte: notification cards from different agents ("claude needs you: approve bun
install", "codex finished: fix/flaky-test", "claude is waiting: saved carts") drop onto a neat stack with
depth (the ones behind scale and dim), each arriving on an arc with a settle. The stack fans out as if
hovered, a card is answered and flicks away on an arc, the rest move up with overlap. Status colors on
each card edge or dot. Pointer: hovering fans the stack.

### infinite-canvas: Pan and Zoom
Principles: Slow in and slow out, Staging. Tech: Canvas 2D, camera choreography.
Line: One canvas for the whole project. Zoom out to see it, zoom in to work.
A camera tour over a real-looking project canvas: many nodes in clusters (a team of agents with edges,
a drawing, a browser, a file, free text labels). The camera zooms out to show the whole project, glides
along an arc to a cluster, zooms in until one chat node fills most of the frame and its text is readable,
holds while it works, then pulls out again. Dot grid stays neutral and scales correctly with zoom (dots
fade out when too dense). Level-of-detail: far nodes are simple blocks, near ones get full chrome.

## F: agent orchestration

### wake-chain: Wake Up
Principles: Timing, Follow through and overlapping action. Tech: Canvas 2D, event propagation.
Line: A finished task wakes the chat that asked for it, once, and never before.
A tree of agents three levels deep. Parents sleep while their children work (a calm sleeping state:
dimmed dot, a small "waiting on 2 tasks" label). A leaf finishes (green), and a "done" pulse travels up
its edge and wakes its parent (the parent's node lifts slightly, status turns blue, it reads the result);
when both children of a parent are done it finishes and wakes the next level up, until the root answers.
Timing is everything: the pulse travels, lands, a beat, the wake. Then the tree resets with a new task.

### delegation: Delegation
Principles: Staging, Follow through and overlapping action. Tech: Canvas 2D, spawn and gather choreography.
Line: Give the task to a team. Get one answer back.
One chat node ("claude, investigate the slow checkout"). It spawns three child nodes that slide out
along new edges ("request tracing", "query analysis", "bundle size"), each with a progress shimmer and
its own terminal lines. Children finish at different times; each result travels back as a small card
that stacks into the parent. The parent writes one answer (a few streaming lines), the children fade
back. Clear staging: the eye always knows where to look.

### plan-tree: The Plan
Principles: Timing, Follow through and overlapping action. Tech: Canvas 2D, checklist tree.
Line: Open the agent's plan beside the chat and follow it step by step.
A plan panel: a tree of steps with sub-steps (markdown checklist feel). The current step has a glowing
marker that glides down as steps complete; each check mark draws itself with a tiny overshoot; finished
sub-steps collapse into their parent with overlap. Midway a person's note (a small amber pin, "keep the
old API for now") attaches to a step and the agent adds a sub-step in response (the list makes room).
Loops back to a fresh plan.

### limit-clock: Resume at Reset
Principles: Timing, Anticipation. Tech: Canvas 2D, clock and status choreography.
Line: When an agent hits its limit, it waits for the reset and picks up where it stopped.
A child chat node works, then stops on a usage limit: status pauses, a ring clock appears around its
dot with the reset time in mono ("resets 21:00"). Its parent sleeps. Time-lapse: the ring sweeps (hours
compressed), the minute marks tick with small stepped motions (timing), a switch "Resume at reset" is
shown on. At the reset the ring closes with a click, the child resumes (shine), finishes, and the parent
wakes. Calm, precise, clock-like.

### agent-loop: The Loop
Principles: Timing, Arcs. Tech: Canvas 2D, orbital tool-call cycle.
Line: Read, edit, run, read the result. Watch the loop close on green.
The agentic loop as an elegant ring: stations on a circle (Think, Read, Edit, Run, Check). A token
orbits with slow in and slow out between stations; at each station a small artifact appears beside the
ring (a file name chip, a two-line diff, a terminal line "bun test", a result "3 failed" in red, then
later "all passed" in green). Each lap is faster and tighter as the agent converges, and the final lap
ends in green with the ring settling. Then a new task starts the loop again.

## G: text, streams and reading

### context-lines: Draw a Line
Principles: Arcs, Secondary action. Tech: Canvas 2D, edge drawing and particle transfer.
Line: Draw a line from what you know to the agent that needs it.
A note node ("brief: saved carts, 30 days, keep API"), a terminal node and a chat node. A cursor draws
a new edge from the note to the chat (the edge follows the cursor on a curve and snaps to the port); the
edge settles into a context edge (accent). Context travels along it as small word-like glyphs on arcs
into the chat, which then answers, quoting the brief. Another line from the terminal: its last lines
travel over. Secondary action: the nodes lean slightly when a line snaps.

### stream: Word by Word
Principles: Timing, Straight ahead and pose to pose. Tech: Canvas 2D, token streaming typography.
Line: Follow the work as it is written, not after the fact.
A chat thread large in frame. The agent answers token by token (words fade and rise into place, a
shine runs over the words being written), a tool call folds into a compact chip that expands briefly
("Read cart.ts", "Edit cart.ts +12 -3", "Run bun test"), a code block builds line by line with syntax
colors, a small diff appears. Rhythm varies like real streaming (bursts and pauses). Loops with a new
question.

### reading-order: In Order
Principles: Staging, Timing. Tech: Canvas 2D, reading order and transcript.
Line: Sketch it, and the agent reads it in the order you meant.
A hand-drawn diagram (Kalam, rough strokes: boxes, arrows, a note) already on the canvas. The agent
reads it: a soft scanning highlight visits elements in the reading order, a small numbered badge pops on
each (1, 2, 3...), and beside it a transcript builds line by line in mono ("1. web calls api", "2. api
writes to db", ...). Distinct from roll A's Napkin: here the drawing stays a drawing; the subject is
reading it in order.

### voice: Say It
Principles: Timing, Appeal. Tech: Canvas 2D, waveform to text.
Line: Say what you want. It becomes a draft you can read before it goes anywhere.
A microphone state: a live waveform (a smooth bar or line waveform) while speaking; the words appear as
a gray preview draft that updates and corrects itself as more audio comes in (words replacing words);
when speaking stops, the waveform folds into the text, the draft turns solid and is inserted into a
terminal prompt as an editable draft (caret blinking, no Enter pressed). Local and private: a small
"on device" mark.

### three-ways: Three Ways
Principles: Slow in and slow out, Staging. Tech: Canvas 2D, three-way merge choreography.
Line: Conflicts are worked out stretch by stretch, never with markers in a file.
The merge overlay: three narrow code columns (base in the middle, ours at the left, theirs at the
right) with stretches highlighted. One stretch at a time: the agent proposes a resolution (a ghosted
stretch slides into a result column below), the person accepts (a check), and the stretch settles in
solid. Differences show as colored line bars (green added, red removed). When all stretches are in, the
result column closes and a merge commit dot joins two branch lines. Clean, readable, calm.

## H: machines, devices and cursors

### handshake: Pairing
Principles: Arcs, Staging. Tech: Canvas 2D, key exchange choreography.
Line: Pair a machine once. After that, it opens like your own.
Three devices as clean line icons: a laptop, a server (headless machine, "npx ruimte"), an iPhone.
Pairing: each shows a small key fingerprint (a short hex-like glyph grid), sealed envelopes travel on
arcs through a broker in the middle that only relays them (they stay sealed: the broker never opens
one), then a direct channel draws itself straight between two devices, and the machine's projects
appear on the other device as rows. Calm, diagram-like, precise.

### phantom-cursor: Second Cursor
Principles: Secondary action, Anticipation. Tech: Canvas 2D, dual cursor choreography.
Line: The agent gets a cursor of its own, so yours stays free.
A Mac app window (a simple generic app: a form or a settings pane) with a session bar on top ("claude
is using Preview", pause and stop). The agent's phantom cursor (glowing outline, name pill) works in it:
moves on arcs, clicks (press squash, ripple), types into a field. Meanwhile your own cursor does
something else in another window. Then "Option-Space" appears as key caps, the phantom freezes (paused
state), your cursor takes over for a moment, then hands back and the phantom resumes.

### device: On Your Phone
Principles: Staging, Appeal. Tech: Canvas 2D, device frame and approval flow.
Line: Answer your agents from your phone.
An iPhone (clean, modern frame) in the frame, maybe a laptop edge behind. A notification drops in
("claude needs you: allow bun install?"), expands into an approval card (Allow / Deny), a thumb press
on Allow (press ripple), and on the laptop the chat resumes (blue shine) with a tiny sync line between
the devices. Next cycle: a question with options answered on the phone. Real iOS-like motion: springy
sheet, blur behind.

### browser-drive: By Address
Principles: Arcs, Timing. Tech: Canvas 2D, browser automation choreography.
Line: An agent drives the browser by address, and sees what you see.
A browser node linked by an edge to a chat node. The address bar types "localhost:3000/cart", the page
loads (a progress bar, blocks building up), a camera shutter moment captures a picture of the page, and
the picture flies along the edge on an arc into the chat as a thumbnail; the agent comments. Then it
navigates to "/checkout", back in history, another picture. Never a click on the page: only address,
history and pictures.

### mission-control: All Hands
Principles: Timing, Staging. Tech: Canvas 2D, status field at scale.
Line: Every session on every machine, at a glance.
A calm overview: a field of forty small node glyphs grouped by machine (three groups with machine
labels "studio", "build server", "iphone"), each with a status light. Status changes ripple naturally:
blue work shimmers, one turns amber and gets a gentle ring, one errors red and retries, finished ones
turn green and settle. A small live counter row in mono ("12 running", "1 needs you", "27 done"). A
processes feel (tiny CPU bars) where it helps. Designed like instrument UI, not a dashboard template.
