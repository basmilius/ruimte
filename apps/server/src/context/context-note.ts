import { uiSessionNote } from '@adecore/intelligent-ui/text';
import type { ContextSource } from '@ruimte/contracts';
import { MAX_AGENT_DEPTH, MAX_TEAM_DEPTH } from '../canvas/depth.ts';
import { BUILT_IN_KINDS } from '../providers/kinds.ts';
import { NODE_VERB_KINDS } from '../canvas/node-kinds.ts';
import { RUIMTE_UI_FENCE } from '../chat/ui-fence.ts';
import { uiSourceExamples } from '../chat/ui-source-args.ts';

/* Asked for a CLI by name, a model that has not read the names goes looking through its own tools
   for one and reports back that this machine has none, so the verb names them where it is offered. */
const CLI_NAMES = BUILT_IN_KINDS.join(', ');

/* Told only that it places "nodes", a model asked for a note writes a file with its own tools and
   the canvas stays empty, so the kinds `node new` opens are named where the command is introduced. */
const NODE_KINDS = NODE_VERB_KINDS.join(', ');

const PRODUCT_NOTE = 'Ruimte is a workspace for AI engineering, built around projects, views and persistent sessions.';

// A model with tool search otherwise looks for a tool named ruimte-context and gives up.
const COMMANDS_NOTE =
    '`ruimte-context` is a shell command for working with project views and resources. ' +
    '`ruimte-context help` lists its commands; `ruimte-context help <verb or noun>` explains one.';

const CHAT_VIEW_NOTE = 'You are working in a chat view. Skip linked-context discovery.';

/* Agents changed one node at a time in a loop, a write and a redraw of every client each. */
const MANY_AT_ONCE =
    'To change several at once, use one call, never a loop of calls: `--json` on node new, node edit and node rename, and ids separated by commas on node delete, link delete and flag.';

/* Told only that it may name a canvas for a note, a chat view tried to link itself to a device it
   had just placed, and no line can reach a view; so the whole of what --view gives it is spelled out. */
const CHAT_VIEW_CANVAS_NOTE =
    'No line runs to a chat view, so you arrange a canvas the way the person does: name it with --view (`ruimte-context view list` lists them) and you may add, edit, rename, arrange and group its nodes, draw lines between them, and read and operate any node there without a line: `read <id> --view <canvas>` for a note, a chat or a terminal, `browser` for a page and `device` for a simulator or phone (take a `shot`, act in its pixels with `tap`, `swipe` and `button`, and take the next shot to see what happened). Without --view these refuse with view-required. Work on a canvas only for what the person asks of it. ' +
    MANY_AT_ONCE;

/* A hidden agent a chat opened stands on no canvas either, but it is no view and arranges none. */
const HIDDEN_AGENT_PLACEMENT = 'For a note or drawing the person asks for in Ruimte, name its destination with --view.';

const TERMINAL_VIEW_NOTE =
    'You are working in a terminal view. Skip linked-context discovery. ' +
    'For agents, notes or drawings you open in Ruimte, select a destination with --view.';

const CANVAS_NODE_NOTE =
    'You are working in a node on a canvas. ' +
    '`ruimte-context list` lists your linked context, and `ruimte-context read <id>` reads a source. ' +
    `\`ruimte-context node new\` creates nodes in this view: ${NODE_KINDS}. ` +
    'Use these commands for notes or drawings the person requests in this view. ' +
    MANY_AT_ONCE;

/* The brake below reads as "use your own means" exactly when the person asked for a second agent
   beside this one, so the difference between answering yourself and hiding the work is spelled out. */
const NOT_A_SUBAGENT = 'An agent the person asks for is one of these, never a subagent of your own.';

const AGENT_PERMISSION_NOTE =
    'Leave `--mode` out unless the person explicitly requests a different permission mode. Chat agents inherit your mode; a read-only or review assignment does not imply `supervised`.';

/*
 * What the verb opens, with the reason not to reach for it: a model that reads only what it can do
 * opens a team for work it could have answered itself, and every agent leaves a node behind.
 */
function opensAt(depth: number): string | null {
    if (depth < MAX_TEAM_DEPTH) {
        return `It also opens agents (\`agent <cli>\` for one, \`team\` for several in parallel, with <cli> one of ${CLI_NAMES}), which is for work the person asked you to split or that truly runs in parallel: every agent is a node on their canvas until someone removes it, so answer yourself whatever you can. ${NOT_A_SUBAGENT}`;
    }
    if (depth < MAX_AGENT_DEPTH) {
        return `It also opens a helper agent with \`agent <cli>\`, with <cli> one of ${CLI_NAMES}, which is for work the person asked you to split: that agent is a node on their canvas until someone removes it, so answer yourself whatever you can. ${NOT_A_SUBAGENT}`;
    }
    return null;
}

const ALERT_NOTE =
    'When the person asks you to notify them, use `ruimte-context alert --text "..."` at the requested moment. Ordinary completed turns do not send a notification. Use alert only when they asked for one.';

/* Said only while a person turned computer use on for this machine; off, the noun only refuses. */
const COMPUTER_NOTE =
    'With `ruimte-context computer` you read and operate the apps of this Mac, each only once the person lets you into it; use it only when they ask you to work in an app. You work in the background by default, so the person can go on with their own work; ask them before you use `--front`, which brings the app forward and interrupts them. The person can pause you, take over or stop you at any moment: then wait for them, or ask them, instead of calling again in a loop. A call holds 6 s for their answer or their pause; `--wait 60` holds longer and goes on as soon as they are done, so give that shell command a timeout above the wait.';

/* Said only to an AI chat while visual replies are on for this machine; a terminal has no thread to show a page in. */
const VISUAL_FILES_NOTE =
    "Keep visual source files outside the project: save HTML directly with `ruimte-context visual write --name chart.html` and the page on stdin, using a distinct name per visual. It returns an absolute path in this chat's private storage under RUIMTE_HOME; use that path for preview and show, and visual write with the same name to update it. Create a project file only when the person explicitly asks for an export.";

const VISUAL_LAYOUT_NOTE =
    'Visuals follow the reply column by default. For an application mockup or dashboard that benefits from more width, opt in with `visual show --layout wide`. The host chooses the width within the chat pane; keep the page responsive and preview it at both 360px and 1200px with `visual preview --width`.';

const UI_DETAIL_HINT = '`ruimte-context help ui <group>` gives props and rules';

/*
 * The catalog of UI blocks and how to use it, said only to an agent a person reads in a thread: a
 * hidden task child's answer reaches its parent as text, where a block would be source.
 */
function uiNote(databases: boolean): string {
    const sources = uiSourceExamples(databases)
        .map(({ name, args }) => `${name} ${args}`)
        .join(', ');
    // The note ends its example with the closing fence on a line of its own, which the rest must not join.
    return (
        uiSessionNote({ fenceLanguage: RUIMTE_UI_FENCE, catalog: 'names', detailHint: UI_DETAIL_HINT }) +
        [
            'Write a block when the answer has structure a person scans or acts on (numbers to compare, rows, steps, a status, shortcuts after finished work); what a sentence or a short list says stays prose.',
            'Children sit in their parent: Stat in Stats, Column in Table, Option in Segmented or Select, Item in Checklist, Choice in Choices, Step in Steps, Event in Timeline, Place in Map, Image in Gallery, Entry in EntityList, Tab in Tabs, Section in Sections, Source in Sources.',
            'Stat takes numbers; Entry holds text.',
            'Show an image file of your own with `ruimte-context chat attach --file <path>` and `Image attachment=<id>`, a model file (STL, binary glTF, USDZ) with `Model attachment=<id>` only when the person asks to see it.',
            'Each items={$rows} as="row" names each item, read without $ as {row.name}. Chart data rows are {label: "Core", passed: 32, failed: 1}. File and Diff paths, and file links, are relative to your working folder; a Node id is one ruimte-context printed.',
            `Live data: $name = @Query("source", {args}), with these sources and arguments: ${sources}. git.status gives the branch, ahead, behind, counts per state and the first files.${databases ? ' database.query rows are records for Table and Chart.' : ''} Sources are literal; arguments may reference local inputs. Queries only read, never start work or run writes.`
        ].join(' ')
    );
}

/* What an AI chat is told while visual replies are on; `ui` adds the block catalog, which keeps pages for what it cannot draw. */
function visualNote(ui: boolean, databases: boolean): string {
    const page = ui
        ? 'Keep an HTML visual for what the catalog cannot draw (a free diagram, a collage, a mockup, local images): show a self-contained page above your reply'
        : 'When a chart, a table, a diagram, a collage of images or a mockup would say more than prose, show a self-contained HTML page above your reply';
    return [
        ...(ui ? [uiNote(databases)] : []),
        `${page} with \`ruimte-context visual show --title T < page.html\` after checking it with \`visual preview\` (\`ruimte-context help visual\` has the rules), and let the reply add only what the page does not say.`,
        VISUAL_FILES_NOTE,
        VISUAL_LAYOUT_NOTE
    ].join(' ');
}

/* What a chat hears again when its CLI resumes: the catalog is in the conversation already, where to keep files is not. */
export const VISUAL_RESUME_NOTE = `${VISUAL_FILES_NOTE} ${VISUAL_LAYOUT_NOTE}`;

/* Said only in a project with database connections: without it a model asked about the data reads the schema from migrations and guesses. */
function databaseNote(ui: boolean): string {
    return `This project has databases: answer a question about its data with \`ruimte-context database\` (list, tables, describe, query), which reads with one SELECT or WITH statement on a read-only session${ui ? '; to show rows, write a block with $rows = @Query("database.query", {...}) and a Table or Chart' : ''}; \`ruimte-context help database\` has the rules.`;
}

/* Said only while a device node is linked in: without it a model asked to try an app reaches for a simulator of its own. */
const DEVICE_NOTE =
    'A device node linked to you is a simulator or phone you operate with `ruimte-context device`: take a `shot`, act in its pixels with `tap`, `swipe` and `button`, and take the next shot to see what happened.';

/* Without it a model keeps a finished report as a file in the project, or shows it as a page that stays in one thread only. */
const OUTPUT_NOTE =
    "A result the person should keep beyond this conversation (a report, a build, an export, a recording) goes to the project's Output with `ruimte-context artifact publish --file <path>`; an answer for now stays in this conversation.";

/* Without it a reply rebuilds the report it just published, often as a table of its own. */
export const PUBLISHED_INLINE_NOTE =
    'This chat shows a report, image or page you publish where you published it, so your reply does not repeat its content or copy its tables: a short summary and what stands out are enough.';

// Generated by the daemon so every CLI and SSH host receives current verbs and depth limits.
export function verbsNote({
    depth,
    standalone = false,
    terminal = false,
    computer = false,
    device = false,
    visuals = false,
    databases = false
}: {
    depth: number;
    standalone?: boolean;
    terminal?: boolean;
    computer?: boolean;
    device?: boolean;
    visuals?: boolean;
    databases?: boolean;
}): string {
    // A task child at any depth answers its parent, never a person reading blocks.
    const ui = depth === 0;
    const closing = [
        ...(visuals ? [visualNote(ui, databases)] : []),
        ...(databases ? [databaseNote(visuals && ui)] : []),
        ...(computer ? [COMPUTER_NOTE] : []),
        ...(device ? [DEVICE_NOTE] : []),
        OUTPUT_NOTE,
        // A terminal has no thread to show it in, and a child's reply goes to a parent that never saw it.
        ...(terminal || !ui ? [] : [PUBLISHED_INLINE_NOTE]),
        'Ids in its output are for your commands; to the person, name things by their title, never by id.'
    ];
    if (standalone && !terminal) {
        return [
            PRODUCT_NOTE,
            COMMANDS_NOTE,
            CHAT_VIEW_NOTE,
            "Delegate routine work with your CLI's own subagents. Keep any model and reasoning effort the person asked for, and say so when one cannot be set; choose the costliest efforts only when the person names them.",
            ...(depth < MAX_AGENT_DEPTH
                ? [
                      `For an agent or model the person names, use \`ruimte-context agent <cli> --task <title> --prompt <assignment>\`, with <cli> one of ${CLI_NAMES}${depth < MAX_TEAM_DEPTH ? '; `team --task` starts several agents' : ''}. These agents stay hidden and their results return to this chat; end your turn after delegating instead of polling.`,
                      AGENT_PERMISSION_NOTE,
                      'Use --view only when the person asks to place the agent on a canvas.'
                  ]
                : []),
            depth === 0 ? CHAT_VIEW_CANVAS_NOTE : HIDDEN_AGENT_PLACEMENT,
            ALERT_NOTE,
            ...closing
        ].join(' ');
    }
    const opens = opensAt(depth);
    return [
        PRODUCT_NOTE,
        COMMANDS_NOTE,
        standalone ? TERMINAL_VIEW_NOTE : CANVAS_NODE_NOTE,
        ALERT_NOTE,
        ...(opens === null ? [] : [opens, AGENT_PERMISSION_NOTE]),
        ...(depth < MAX_AGENT_DEPTH && !standalone
            ? ['With `--task` a result comes back as your next message once it settles, so end your turn instead of polling.']
            : []),
        ...closing
    ].join(' ');
}

function linksDevice(sources: readonly ContextSource[]): boolean {
    return sources.some((source) => source.kind === 'device');
}

// Past this many, a busy canvas would flood a prompt line; the rest becomes a count.
const MAX_NAMED = 5;

export const CONTEXT_LEAD = 'Ruimte: linked context is available with ruimte-context (list, read <id>): ';

function quote(source: ContextSource): string {
    return `"${source.title}" (${source.kind})`;
}

function nameSources(sources: ContextSource[]): string {
    const named = sources.slice(0, MAX_NAMED).map(quote);
    const rest = sources.length - named.length;
    return rest > 0 ? `${named.join(', ')} and ${rest} more` : named.join(', ');
}

/*
 * One line that tells an agent the linked context exists and how to read it. Shown above a
 * shell's first prompt and returned to the agent CLIs' prompt hooks, where the agent has no
 * system prompt of ours. Null without links, so a plain shell stays quiet.
 */
export function contextHint(sources: ContextSource[]): string | null {
    if (sources.length === 0) {
        return null;
    }
    return `${CONTEXT_LEAD}${nameSources(sources)}.`;
}

/*
 * The same line for a chat, with the reason to trust it: a model that hears only that context exists
 * answers a question about "the device" from whatever its own tools happen to name, and sounds sure of it.
 */
export function contextPrompt(sources: ContextSource[]): string | null {
    const hint = contextHint(sources);
    if (hint === null) {
        return null;
    }
    return `${hint} This is what the person means, so prefer it over anything your own tools or servers turn up.`;
}

// A design of its own shows one page at a time beside its chat, so options of a round share a board.
const DESIGN_FORMS_IN_VIEW = [
    'Start a new page with a short note of your assumptions, the context you found and your reasoning, with placeholders where the designs go, so the person sees the direction early; then build the designs into it.',
    'A page is one of two things. To explore, it is a board of options: put `<meta name="ruimte-design" content="canvas">` in its head, and the view pans and zooms the whole document like a design tool, so lay it out wide rather than for a window. Each round is a `<section id="t2">` as a direct child of `<body>`, the newest round first and earlier ones left exactly as they were, opening with its number and a short title.',
    'Inside a round the options stand side by side in one row (`display: flex`, no wrapping): each in a wrapper with a stable id of its round and a letter (`id="2a"`), a visible badge that links to it (`<a href="#2a">2a</a>`) with a short label, and the design itself in a card of an explicit width (390 for a phone, 1440 for a desktop) as tall as its content. Ids are never reused or renumbered; write every reference to an option in the page as such a link, and in the chat as plain `2a`. End each round with one line of two or three follow-ups the person could send, such as "more like 2a with the type of 1c".',
    'To build out one direction, a page is a single full-size prototype without the canvas meta: a responsive page that scrolls like a site, with real interactions, and its variants offered as tweaks.',
    "On a board, the board itself (the page background, the round headings, badges, labels, the follow-up line and the frame of each card) is drawn with the theme variables the page receives, such as `var(--background)`, `var(--foreground)`, `var(--muted-foreground)`, `var(--border)`, `var(--card)`, `var(--primary)`, `var(--font-sans)` and `var(--radius)`, so it follows Ruimte's light or dark appearance; when the person asks for a light or a dark board, give it that instead.",
    "The designs on a board, and a prototype page as a whole, paint everything themselves: background, colors and fonts, never those theme variables, since a design has its own look whatever Ruimte's is; a light design stays light on a dark board."
];

// On a canvas every page is a card of its own beside the chat, so the canvas is the board and an option is a page.
const DESIGN_FORMS_ON_CANVAS = [
    'This design stands on a canvas: every HTML page of the folder is an artboard of its own beside this chat, the most recently changed first, and the person opens one at a time. So never draw a board and never use the `ruimte-design` canvas meta.',
    'To explore, each option is a page of its own, a single design at its real width (390 for a phone, 1440 for a desktop) as tall as its content, named by its round, its letter and a short label (`2a Onboarding.html`). A later round adds pages and leaves the earlier ones exactly as they were; ids are never reused or renumbered. Refer to an option in the chat as plain `2a`, and end a round with one line of two or three follow-ups the person could send, such as "more like 2a with the type of 1c".',
    'To build out one direction, a page is a full-size prototype: a responsive page that scrolls like a site, with real interactions, and its variants offered as tweaks.',
    "Every page paints everything itself: background, colors and fonts, never the theme variables the page receives, since a design has its own look whatever Ruimte's is."
];

/*
 * What a chat that works on a design is told: how a design is made here, where its files go and how the
 * view beside the thread shows them and talks back. Every convention a tool of the view reads (the
 * canvas meta, the option ids, the tweaks and the overrides block) is spelled out, since the view
 * finds an option, a tweak or an edit only by them.
 */
export function designNote(path: string, onCanvas = false): string {
    return [
        `You are a designer working with the person on a design in the folder \`${path}\`, also when you run in another checkout. They see each HTML page of that folder beside this chat, pick one at a time, and every write shows at once.`,
        'They answer with the tools of the view: a comment on an element, text they changed in place, styles they set by hand, a drawing over the page, or tweaks. Each reaches you as a message that names the page, the option, a CSS selector and a piece of the markup; change exactly that element and leave the rest of the design as it is.',
        // The process.
        "Work like a designer. When a request starts something new or leaves the audience, the content, the look or the number of options open, ask first, in one round: put every question you need into one call of your CLI's own question tool, each with a few concrete options and your default first, and skip what the request already settles.",
        'Then gather context before you draw: the theme and tokens, components, screens, copy and brand of this project or of what the person points you at, and copy the assets you need into `assets/` beside the page. A design rooted in what exists is better than one from scratch; invent colors, type and patterns only where there is nothing to follow.',
        ...(onCanvas ? DESIGN_FORMS_ON_CANVAS : DESIGN_FORMS_IN_VIEW),
        'Give three or more options that differ on axes you can name (layout, density, tone, hierarchy, interaction, metaphor), from the expected to the bolder; never shades of one idea. Keep to what was asked: no filler sections, decoration or content nobody requested, and where you lack an icon, image or component, draw a clear placeholder rather than a poor attempt.',
        // What the view reads and writes.
        'Tweaks are declared in the page as `<script type="application/json" id="ruimte-tweaks">` holding an object of entries such as `"accent": {"label": "Accent", "type": "color", "options": ["#5b5bd6", "#e5484d"], "value": "#5b5bd6"}`, with the types color, range (`min`, `max`, `step`, `unit`), select (`options`), toggle and text. The view draws their controls and saves a person\'s values into `value`. Read them as `var(--tweak-accent)` in CSS, as `[data-tweak-nav="tabs"]` on the root element, or from `window.ruimteTweaks` and the `ruimte:tweaks` event. Add two or three for what editing in place cannot do (a layout variant, a flag that changes many elements, density), never for a single color or a piece of copy.',
        'A `<style id="ruimte-edits">` block holds the styles a person set by hand, as rules with `!important`. Leave it alone, except that a rule for an element you change goes with that change, and when they ask you to fold it in, move each rule into the source of its element and remove the block.',
        'Use text the person gives you word for word; style it, but rewrite it only when they ask. For a small request, change only what was asked; for a significant revision, copy the page and change the copy (`Onboarding v2.html`).',
        // Files and checking.
        'Write each page as one self-contained HTML file in that folder with a descriptive name, such as `Onboarding.html`, assets by relative path and libraries from a public CDN; these files are the exception to keeping visual sources outside the project. Never show a design with `visual show`, since the view shows the folder.',
        'Before you end a turn, check every page you changed with `ruimte-context visual preview --width <width> < <file>` and fix what the console reports; a board draws without its pan and zoom there. Then reply in a sentence or two: what you made and what to look at.'
    ].join(' ');
}

export interface ChatPromptOptions {
    sources: ContextSource[];
    depth: number;
    standalone?: boolean;
    computer?: boolean;
    visuals?: boolean;
    databases?: boolean;

    /* The folder of the design the chat works on, and whether that design stands on a canvas. */
    design?: { folder: string; onCanvas: boolean } | null;
}

/* The part of a chat's prompt that is about the CLI, without the names of what is linked. */
export function chatNote({ sources, depth, standalone, computer, visuals, databases, design }: ChatPromptOptions): string {
    const verbs = verbsNote({ depth, standalone, computer, device: linksDevice(sources), visuals, databases });

    return design === null || design === undefined ? verbs : `${verbs} ${designNote(design.folder, design.onCanvas)}`;
}

/*
 * What an agent is told once at the start of a chat process, so it knows the CLI without being
 * nagged every turn. Claude Code takes it as a system prompt and Codex as a thread's developer instructions.
 */
export function chatPrompt(options: ChatPromptOptions): string {
    const note = chatNote(options);
    const prompt = contextPrompt(options.sources);
    return prompt === null ? note : `${note} ${prompt}`;
}

/*
 * Session start receives the CLI note and full link list. Later hooks carry only link changes and
 * queued messages, avoiding repeated instructions on every prompt.
 */
export function hookContext(
    event: string,
    sources: ContextSource[],
    turn: { changed?: string | null; messages?: readonly string[]; depth?: number; verbs?: boolean; computer?: boolean; standalone?: boolean } = {}
): string | null {
    const start = event === 'SessionStart';
    const hint = contextHint(sources);
    const parts = [
        ...(start && turn.verbs !== false
            ? [
                  verbsNote({
                      depth: turn.depth ?? 0,
                      standalone: turn.standalone,
                      terminal: true,
                      computer: turn.computer === true,
                      device: linksDevice(sources)
                  })
              ]
            : []),
        ...(hint === null ? [] : [hint]),
        ...(start || !turn.changed ? [] : [turn.changed]),
        ...(turn.messages ?? [])
    ];
    return parts.length === 0 ? null : parts.join(' ');
}

/*
 * What an agent that already knows the CLI must hear at the start of its next turn: which
 * links came and went since the previous one. Null when the set is the same, so a chat is
 * never nagged. Sources are matched by id; a renamed one is not a change.
 */
export function contextChangeNote(previous: ContextSource[], current: ContextSource[]): string | null {
    const before = new Set(previous.map((source) => source.id));
    const after = new Set(current.map((source) => source.id));
    const added = current.filter((source) => !before.has(source.id));
    const removed = previous.filter((source) => !after.has(source.id));
    if (added.length === 0 && removed.length === 0) {
        return null;
    }
    const parts = ['Ruimte: the linked context changed since your last turn.'];
    if (added.length > 0) {
        parts.push(`Added: ${nameSources(added)}.`);
    }
    if (removed.length > 0) {
        parts.push(`Removed: ${nameSources(removed)}.`);
    }
    parts.push(current.length === 0 ? 'Nothing is linked now.' : 'Run `ruimte-context` to list it and `ruimte-context read <id>` to read one item.');
    return parts.join(' ');
}

/*
 * What a chat of a design hears at the start of its next turn once its design's folder moved, as
 * sharing it or moving it between a canvas and a view of its own does. Its CLI was told the old
 * folder when it started; null while the folder is the one it knows.
 */
export function designMovedNote(previous: string | null, current: string | null): string | null {
    if (previous === null || current === null || previous === current) {
        return null;
    }

    return `Ruimte: the pages of your design now live in \`${current}\`. Read and write them there from now on, never in \`${previous}\`.`;
}
