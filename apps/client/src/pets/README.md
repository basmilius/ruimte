# Pets

A small figure on every agent's node of a canvas, and on a chat or a terminal open as a view of its
own, which a person turns on in Settings, Pets. Off to start with.

What a pet is and how it is drawn lives here, in `src/pets`: the figures, the paint, the shared beat,
the sets, the kids, the strips a person added, and the pets of views (`ViewPet.tsx`). Where a pet
stands on a canvas, along the bottom of the screen, the visitor and the trips to a page live in
`src/canvas/pets`. Everything here is the client's: what a pet shows comes from the state the client
already holds (`chat.status`, a terminal's `session.status` from the CLI's hooks), and nothing reads
the file system, the daemon's folders or a project file.

- Which nodes have one: a chat, a design (through the chat under its own id, as its status dot), and a
  terminal whose CLI reported through its hooks (`petNodeKey` in `canvas/pets/placement.ts`, `petOf` in `pet-state.ts`). A node
  a collapsed group hides has none.
- What it shows: working, waiting on you, idle or stopped. Waiting is the "needs you" every count
  reads (`groupAttention`). A waiting pet has a black speech bubble with an orange exclamation mark
  and jumps until the question or approval is answered. The bubble stands over its head, or beside it
  where another node lies there (`petCrowded`), such as one 40 pixels above, so it never covers that
  node. A wait a person snoozed keeps its bubble until it is answered but does not jump. With reduced
  motion nothing moves: every pet holds one frame, and that follows the system setting as it changes.
- A pet whose node has a color wears a bow in it on its head (`bow` and `bowColors` in `pixel.ts`),
  so a person tells which pet is whose. Each pose of a built-in figure says where its head is; a
  figure a person added gets none, since nothing says where its head is, and the visitor, which
  belongs to no node, none either.
- A pet takes a kid along, the same figure at half the size, for each sub-agent of its chat at work,
  three at most (`kids.ts`): the running rows of kind `subagent` in the thread under the node's own
  id, the CLI's own and the tasks it gave, but not a task whose node has a pet of its own. The kid of
  a task that waits for a limit to lift sleeps. On a node they stand in a row behind the pet and take
  no press. A terminal has none, since nothing of its CLI's sub-agents reaches the client. Settings,
  Pets, Sub-agents turns them off (`petsSubagents`).
- A pet comes and goes with a teleport (`teleport.ts`, `beam.ts`): when its agent starts or ends, when
  its node goes, and when Pets, Where pets are or In views of their own is changed. One on its way out
  is drawn as it was last seen, a picture that takes no press and has no kids a test counts, and the
  layer it is in stays until it is gone (`useLinger`, `useDeparting`). Settings, Pets, Teleport picks
  the way for every pet (`petsBeam`): Gather, the default, Scanline, Pixel rain, Transporter, Portal,
  or Random, a new one for every beam. A beam draws per cell on a paint of its own, wider than the
  figure, for the pixels that stray. A node that only scrolls into view mounts no new figure, so a pan
  beams nothing. With reduced motion a pet is there or gone at once.
- A pet paints its canvas only when the picture changes (`petPainter`), so a strip of one frame at
  rest paints once.
- A click goes to the node (`goToNode`): the camera centers on it and selects it, and Back in the
  camera history returns.
- Only the figure takes a press (`petHitBox`, 52 by 38 world pixels from its node's top edge up, which
  covers it at rest and through its jump); the bubble never does. Where that box lies on another node
  (`coversOtherNode`, a group the node stands in aside), or while a line is being aimed, the pet takes
  no press at all, so a press on the bottom of a node standing close above still lands in that node.
  Its button still takes the keyboard. A text on the canvas is not counted, and neither is a card
  beside a node, such as a design's pages.
- One interval for the page drives every pet (`ticker.ts`), only while a pet is mounted, and a pet
  whose node is out of view mounts no canvas (`useNodeInViewport`).

## Along the bottom of the screen

Settings, Pets, Where pets are (`petsPlace`) takes the pets off their nodes and puts them along
the bottom of the canvas, over it in its cell's overlay and under the dock (`PetRoam.tsx`). Nodes
still have them, so a node a collapsed group hides has none here either.

- `roam.ts` decides where each one is, a beat at a time on the shared clock: it rests a while in its
  mood's pose, walks (`walk`, the one pose only this place uses) somewhere else on the floor or onto
  the dock, and rests again. One that waits on you or stopped stays where it is. New ones start
  spread over the floor. A pet whose way runs past another jumps over it; one already in the air
  passes under. A walk ends only where no other pet rests or is headed, and one put down in another
  walks off at once.
- The floor runs between what stands on it: the dock, the minimap and a prompt card low enough to
  touch a pet (`PET_LEDGE_ATTRIBUTE` and `PET_WALL_ATTRIBUTE` in `attributes.ts`, the prompt stack by
  its own attribute). A pet hops onto the dock and off again at its ends; the minimap it only walks
  up to. A dock that hides, or a prompt card that comes up over it, sends the pets on it to the floor
  beside it.
- The obstacles are measured on every beat, in whole pixels, so the ground changes only when one moves.
- Kids trail their pet a gap behind (`follow`); one ahead of it waits for it to pass, and one cut off
  from it jumps across. At rest they stand in a row from the pet, going on at its other side where
  the ground ends. No pet jumps over a kid or keeps clear of one.
- With reduced motion they only take their place.
- A click goes to the node, as on a node; the bubble and the bow are the same.

## The visitor

While Pets is off, a pet now and then stands beside a node on screen for four seconds and fades
away (`visitor.ts`), never where it would stand on another node. One clock for the page, a first
visit 20 to 60 minutes after a canvas opens and the next 20 to 60 minutes after that, only while the
window is visible and nobody is dragging or has a node maximized. It takes no press. It is on by
default; Settings, Pets, Visitor turns it off (`petsVisitor`).

## Sets

Settings, Pets, Figures switches one set or more on (`petsSets`): the buddies, the fox and the frog,
and the figures a person added. A node's pet comes from the set that scores highest for its id
(`petChoiceFor`), so it keeps its set in every window, and a set that joins or leaves moves only the
pets it takes or gave up. The visitor comes from the set of the node it visits. The last set picked
stays, and a stored `petsSprite` is read as a set of one.

Settings, Pets, Per agent gives a CLI a set of its own (`petsByAgent`, by the CLI's kind), such as
a cat a person added for Claude and another for Codex (`agentPetChoice`). A CLI on Default, a visitor,
and a CLI whose figure was removed since take theirs from the sets switched on.

## A figure of your own

Settings, Pets, Add figure opens a dialog (`PetFigureDialog.tsx`) with a name and a row for
every state: Standing (the visitor), Walking (along the bottom of the screen), Working, Needs you (the
jump is this strip lifted), Idle and Stopped, each with a preview painted as on the canvas. Only the
files picked are read, and nothing is kept before Save. A figure is kept as data URLs in this
client's storage (`ruimte.pets.sprites`), which every window of the app shares and no machine sees;
the window that saves a figure last wins. What is read back goes through the same checks as an import
(`storedSpriteOf`, `storedStripOf`): a figure whose Standing strip fails is dropped, any other strip
that fails drops out alone. The previews decode under an id of their own (`previewSpriteOf`), so a
figure's pets keep their images while it is changed.

A state plays its own strip, or Standing's, which every figure needs (`stripFor`), and Standing's
too where its own decoded to another size than it says. Stopped without its own tips Standing's over
and fades it. Standing's strip is stored where the one strip was and the others under `strips`, so a
figure from before plays as it did, and an older Ruimte reads a newer one as its Standing strip.

The format of a strip:

- A PNG or a WebP image, at most 64 KB. The bytes must start with the signature of that format; an
  SVG, or any other file with a PNG name, is refused.
- One row of square frames, left to right, with no gaps. A frame is as high as the image, so the
  width is the height times the number of frames.
- A frame is 8 to 256 pixels high, and a strip has 1 to 16 frames. A single square image is a strip
  of one frame. The size is read from the header before anything decodes.
- A transparent background. The frames are scaled without smoothing, so pixel art stays sharp;
  the figure is drawn about 36 pixels high on the canvas at 100%.
- A strip plays in a loop: at a walk while the agent works or waits on you, slower while it is idle
  or stopped. The bubble and the jump are drawn over it as for a built-in figure.

At most 8 figures are kept, and all their strips together take at most 512 KB, eight strips of the
largest size. A figure you added stands for every agent its set is given to; the built-in sets have
one for Claude and one for Codex, and every other CLI gets Claude's.

## In a view of its own

A chat or a terminal open as a view of its own has its pet too, while Settings, Pets, In views of their
own is on (`petsInViews`, on to start with). It is the pet its node would have: the same `petOf`, the
same set for the same id, and for a chat the same kids. A view has no color, so its pet wears no bow.

- A chat's pet stands on the top edge of the composer card, near its right corner, with its kids
  behind it (`ChatViewPet`). The card holds the open question while there is one, so the pet stands
  beside what waits on you. The card is ADE CORE's, so it is found by its class and measured again
  when it changes. A composer narrower than 320 pixels has no pet.
- A terminal's text takes every pixel of its body, so its pet stands in the cell's bar at half its
  size, its feet on the line under the bar, the bubble beside its head (`TerminalViewPet`).
- A press hands the keyboard over: to the open question or the field to type in, or to the terminal.

## A trip to a page

While Pets is on its nodes, an agent's pet walks over the line to a page or a device the agent works
in (`canvas/pets/page-trip.ts`, `use-page-trip.ts`): a browser or device node at the other end of a
target line from its node. The machine asks a page through the client that holds it
(`browser/page-hold.ts`), and the ask names the page and not the agent, so the line says whose it is.
A device counts as asked for as long as `device.operated` names the agent's node.

- It sets off at the first ask, stays on the page's top edge while the asks come, and walks home after
  five quiet seconds. It moves on to another page or home only after four seconds on one, so an agent
  switching pages does not send it back and forth.
- It walks the line's own route (`lineRoutes`), in under a second and a half however long the line.
- A pet that waits on you is home at once, where the question is answered. A page out of view keeps
  it home, and with reduced motion it only takes its place.
- On a page a press still goes to its own node.
