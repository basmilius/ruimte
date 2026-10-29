import { actionDescription } from '@ruimte/actions';
import { ChatSubagentSourceSchema, ContextSourceSchema } from '@ruimte/contracts';
import { alertVerb } from './alert-verb.ts';
import { ARTIFACT_ACTIONS, ARTIFACT_DETAIL, ARTIFACT_SUMMARY } from './artifact-verb.ts';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
import { CHAT_ACTIONS, CHAT_DETAIL, CHAT_SUMMARY } from './chat-verb.ts';
import { nodeDeleteAction, nodeListAction, nodeNewAction } from './node-verb.ts';
import { agentVerb } from './agent-verb.ts';
import { answerVerb } from './answer-verb.ts';
import { arrangeAction } from './arrange-verb.ts';
import { BROWSER_ACTIONS, BROWSER_DETAIL, BROWSER_SUMMARY } from './browser-verb.ts';
import { COMPUTER_ACTIONS, COMPUTER_DETAIL, COMPUTER_SUMMARY } from './computer-verb.ts';
import { DATABASE_ACTIONS, DATABASE_DETAIL, DATABASE_SUMMARY } from './database-verb.ts';
import { DEVICE_ACTIONS, DEVICE_DETAIL, DEVICE_SUMMARY } from './device-verb.ts';
import { diagramAction } from './diagram-verb.ts';
import { drawingAction } from './drawing-verb.ts';
import { flagVerb } from './flag-verb.ts';
import { forkVerb } from './fork-verb.ts';
import { nodeColorAction } from './color-verb.ts';
import { nodeEditAction } from './edit-verb.ts';
import { groupAction } from './group-verb.ts';
import { LANGUAGE_ACTIONS, LANGUAGE_DETAIL, LANGUAGE_SUMMARY } from './language-verb.ts';
import { TEMPLATE_ACTIONS, TEMPLATE_DETAIL, TEMPLATE_SUMMARY } from './template-verb.ts';
import { PROVIDER_ACTIONS, PROVIDER_DETAIL, PROVIDER_SUMMARY } from './provider-verb.ts';
import { LAUNCHES_ACTIONS, LAUNCHES_DETAIL, LAUNCHES_SUMMARY } from './launch-verb.ts';
import { linkDeleteAction, linkListAction, linkNewAction } from './link-verb.ts';
import { notifyVerb } from './notify-verb.ts';
import { openAction } from './open-verb.ts';
import { operationVerb } from './operation-verb.ts';
import { planVerb } from './plan-verb.ts';
import { renameAction } from './rename-verb.ts';
import { ROUTINE_ACTIONS, ROUTINE_DETAIL, ROUTINE_SUMMARY } from './routine-verb.ts';
import { PROJECT_ACTIONS, PROJECT_DETAIL, PROJECT_SUMMARY } from './project-verb.ts';
import { SECRET_ACTIONS, SECRET_DETAIL, SECRET_SUMMARY } from './secret-verb.ts';
import { doneVerb, taskListAction, taskNewAction } from './task-verbs.ts';
import { teamVerb } from './team-verb.ts';
import { UI_DETAIL, UI_GROUP_ACTIONS, UI_SUMMARY } from './ui-verb.ts';
import { VIEW_ACTIONS, VIEW_DETAIL, VIEW_SUMMARY } from './view-verb.ts';
import { VISUAL_ACTIONS, VISUAL_DETAIL, VISUAL_SUMMARY } from './visual-verb.ts';
import { worktreeVerb } from './worktree-verb.ts';
import { summaryLines } from '@adecore/agents/context';
import { SCOPE_LINE, SNOOZE_LINE, defineHelp, defineNoun, dryRunLine, type ContextVerb, type VerbCall, type VerbEntry } from './verb.ts';

/* The one line about failure every help output ends with; the codes are the CLI's, which is what runs the verb. */
const REFUSAL_LINE =
    'refusal\trefused<TAB><code><TAB><message> on stderr, then what you can pick instead\texit 0 done, 1 the daemon failed, 2 not in a live Ruimte session, 3 refused';

/* Agents repeat ids to people, who know nodes, views and plans only by their titles. */
const IDS_LINE = 'ids\tIds in this output are for your commands. When you talk to the person, name things by their title, never by id';

export function verbSummaryLines(): string[] {
    return summaryLines<VerbCall>(VERBS);
}

const helpVerb = defineHelp({
    entries: () => VERBS,
    root: () => [SCOPE_LINE, IDS_LINE, dryRunLine()],
    refusal: REFUSAL_LINE
});

const listVerb: ContextVerb = {
    served: 'context',
    name: 'list',
    usage: '',
    summary: `${actionDescription('context.list', 'agent')} Also what ruimte-context prints without a verb.`,
    detail: [
        'prints\tid\tkind\ttitle\tflag\tsnoozed\tone line per linked source, nothing when the person linked none; flag is the color the person flagged it with, or -',
        SNOOZE_LINE,
        `kinds\t${ContextSourceSchema.shape.kind.options.join('\t')}\ta note and a text on the canvas both arrive as text`,
        'note\tThe id is what ruimte-context read takes; this list is what your lines let you read, and besides it only what a person pointed you at with # in a message and an agent you opened yourself',
        'note\tA line from a group lists what lies inside that frame, each on a line of its own, a frame inside it included; the group itself is never a line here',
        SCOPE_LINE
    ]
};

const readVerb: ContextVerb = {
    served: 'context',
    name: 'read',
    usage: '<id> [--tail N] [--subagent T] [--view V | --project P] [--elements | --image] [--json]',
    summary: actionDescription('context.read', 'agent'),
    detail: [
        'argument\t<id>\trequired\tThe id of a source, from ruimte-context list, or of an agent you opened yourself, or of what a person pointed you at with #, or with --view of any node or text on that canvas; a drawing or diagram also takes the id of the node that shows it',
        'flag\t--tail N\toptional\tOnly the last N lines, N a positive whole number; without it the whole source',
        'flag\t--view V\toptional\tOnly from a chat view: the canvas the source stands on, which lets you read every node and text there, other chats and terminals included, without a line; a node on a canvas reads over its lines and leaves it out',
        'flag\t--project P\toptional\tAny view, node or text of another project open on this machine, other chats and terminals included, without a line, while a person lets agents reach them; ruimte-context project list lists them. Not together with --view',
        `flag\t--subagent T\toptional\tThe whole conversation of one subagent of a chat you may read instead of the chat, T the id in its > Subagent line; read from ${ChatSubagentSourceSchema.options.join(' or ')}; --tail counts lines of that conversation`,
        'flag\t--elements\toptional\tOnly a drawing: its revision and its elements as JSON, each with id, kind, box, stroke, fill, fillColor and text, which is what ruimte-context view drawing edits by id',
        "flag\t--image\toptional\tA drawing, a diagram or a canvas a person pointed you at, drawn to a PNG in this chat's own folder outside the project; prints the path, which your own tool that reads images opens. Only an AI chat has that folder",
        'flag\t--json\toptional\tOne JSON object instead: text holds what the read prints, and a chat adds usage, the same numbers as its > Usage line with cache.expiresInMs negative once the cache went cold',
        'prints\tThe source itself, as text, not as tab-separated lines',
        'kind\ttext\tThe text the person wrote: a note or a text on the canvas\t--tail counts its lines',
        `kind\tterminal\tThe screen of that session, its last ${MAX_SCREEN_LINES} lines, read the moment you ask\t--tail counts screen lines and cannot reach past those ${MAX_SCREEN_LINES}`,
        'kind\tchat\tOne > Usage line first: its CLI and model, its context tokens of the window, and how long its prompt cache stays warm or how long ago it went cold; then the plans of that chat as text, then the whole thread as markdown: who said what, what every tool ran, and one line per subagent with the id --subagent takes\t--tail counts lines of the thread and leaves the > Usage line and the plans out of the count',
        'kind\tchat\tA prompt cache that went cold makes the next turn of that chat read its whole context again, so a message sent while it is warm costs less; ruimte-context provider limits reads the plan of the account you run on',
        'kind\tchat\tA Workflow call has one line per phase under its > Tool line, each agent of that phase with its state and the id --subagent takes',
        'kind\tchat\tA question or an approval in the thread is one > Question or > Approval line with its state and its request id; a question that still waits lists its question ids and choices under it, which is what ruimte-context answer takes',
        'reference\tA view, node, text or chat the person pointed you at with # in one of your messages reads by the id that message named, with no line to it and without showing up in ruimte-context list, for as long as that message is in your thread',
        'reference\tA # to a whole canvas lets you read every node and text on it by its id; writing in one of them still takes a # or a line of its own',
        'kind\tcanvas\tOnly one a person pointed you at with #: every node with its id, kind, title, place and size, what each group frames, every text and every line between nodes; each id then reads on its own\t--tail does nothing here',
        'kind\tdatabase\tOnly one a person pointed you at with #: its connection, schema, table, mode and filter, and the ruimte-context database command that reads that table; a connection this machine does not have is said, and nothing is refused\t--tail does nothing here',
        'own\tAn agent you opened yourself, with agent or team, reads by its id with no line from it into you and without showing up in ruimte-context list, --tail and --subagent included; an agent it opened in turn is its to read, not yours',
        'kind\tdrawing\tThe text of the drawing in reading order, and the picture itself as SVG under it\t--tail counts lines of the reading order and leaves the SVG out',
        'kind\tdiagram\tIts title, every node layer by layer (sub in brackets), every edge with its label, what each group wraps, and the SVG under it\t--tail counts lines of that list and leaves the SVG out',
        'kind\tfile\tIts path and a line telling you to read it yourself, since your own tools see a fresher copy\t--tail does nothing here',
        "kind\tartifact\tThe version of this project's Output the node shows, the latest unless a person pinned one: its files, then the text of the first when it is text\t--tail counts lines of the whole",
        "kind\troutine\tThe routine the node shows, worded the way routine list words it, its newest runs, and an agent routine's prompt under them\t--tail counts lines of the whole",
        'kind\tbrowser\tThe address of the page and, under it, the text of that page as this machine has it open, read the moment you ask; the address alone when no page of it is open here\t--tail counts lines of the page text and keeps the address',
        'kind\tbrowser\tReading leaves the page where it is; ruimte-context browser is what sends it somewhere, over the same line',
        'kind\tdevice\tWhich device the node points at: its name, platform, kind and runtime, and the state, deviceId and backendId this machine knows it by, or a line saying the device is not here right now\t--tail does nothing here',
        'kind\tdevice\tReading leaves the device alone; ruimte-context device is what photographs and operates it, over the same line',
        'cheap\tThe last fifteen lines of a neighbour is usually the whole answer; read the source whole only when it is not',
        'direction\tBetween two agents a line runs one way: the one you draw into another agent lets it read you, and reading it back takes a line from it into you, which ruimte-context link new --from <id> --to <you> draws; an agent you opened yourself needs none',
        'direction\tA node that is no agent, a note, a page, a file, a drawing or a diagram, you read over a line whichever way that line runs',
        'chat view\tA chat that is a view of its own has no lines, since a line only joins two nodes of one canvas: it reads a node by naming its canvas with --view, and without it a node of a canvas refuses with view-required',
        'refusals\tnot-linked\tunreadable\tunknown-source\tunknown-subagent\tview-required\tnot-on-view\tnot-a-chat-view\tnot-a-canvas\tbad-arguments\tprojects-not-reachable\town-project\tproject-not-open\tvisual-needs-chat\tvisual-too-large\tpreview-unavailable\tpreview-timeout\tpreview-failed\tthe whole set this verb refuses with',
        SCOPE_LINE
    ]
};

const nodeNoun = defineNoun({
    name: 'node',
    summary: 'Lists, adds, writes in, renames, colors, removes, frames and lays out the nodes of a canvas',
    detail: [
        'note\tA node is a note, a browser, a drawing, a diagram, a file, a terminal, a chat or a group on a canvas; agent and team add agent nodes that start working',
        SCOPE_LINE
    ],
    actions: [nodeListAction, nodeNewAction, nodeEditAction, renameAction, nodeColorAction, nodeDeleteAction, groupAction, arrangeAction]
});

const linkNoun = defineNoun({
    name: 'link',
    summary: 'Lists, draws and removes the lines of a canvas, which is what lets an agent read the node at the other end of a line',
    detail: [SCOPE_LINE],
    actions: [linkListAction, linkNewAction, linkDeleteAction]
});

const browserNoun = defineNoun({
    name: 'browser',
    summary: BROWSER_SUMMARY,
    detail: BROWSER_DETAIL,
    actions: [...BROWSER_ACTIONS]
});

const deviceNoun = defineNoun({
    name: 'device',
    summary: DEVICE_SUMMARY,
    detail: DEVICE_DETAIL,
    actions: [...DEVICE_ACTIONS]
});

const computerNoun = defineNoun({
    name: 'computer',
    summary: COMPUTER_SUMMARY,
    detail: COMPUTER_DETAIL,
    actions: [...COMPUTER_ACTIONS]
});

const viewNoun = defineNoun({
    name: 'view',
    summary: VIEW_SUMMARY,
    detail: VIEW_DETAIL,
    actions: [...VIEW_ACTIONS, openAction, diagramAction, drawingAction]
});

const uiNoun = defineNoun({
    name: 'ui',
    summary: UI_SUMMARY,
    detail: UI_DETAIL,
    actions: [...UI_GROUP_ACTIONS]
});

const chatNoun = defineNoun({
    name: 'chat',
    summary: CHAT_SUMMARY,
    detail: CHAT_DETAIL,
    actions: [...CHAT_ACTIONS]
});

const artifactNoun = defineNoun({
    name: 'artifact',
    summary: ARTIFACT_SUMMARY,
    detail: ARTIFACT_DETAIL,
    actions: [...ARTIFACT_ACTIONS]
});

const visualNoun = defineNoun({
    name: 'visual',
    summary: VISUAL_SUMMARY,
    detail: VISUAL_DETAIL,
    actions: [...VISUAL_ACTIONS]
});

const launchesNoun = defineNoun({
    name: 'launches',
    summary: LAUNCHES_SUMMARY,
    detail: LAUNCHES_DETAIL,
    actions: [...LAUNCHES_ACTIONS]
});

const routineNoun = defineNoun({
    name: 'routine',
    summary: ROUTINE_SUMMARY,
    detail: ROUTINE_DETAIL,
    actions: [...ROUTINE_ACTIONS]
});

const secretNoun = defineNoun({
    name: 'secret',
    summary: SECRET_SUMMARY,
    detail: SECRET_DETAIL,
    actions: [...SECRET_ACTIONS]
});

const projectNoun = defineNoun({
    name: 'project',
    summary: PROJECT_SUMMARY,
    detail: PROJECT_DETAIL,
    actions: [...PROJECT_ACTIONS]
});

const databaseNoun = defineNoun({
    name: 'database',
    summary: DATABASE_SUMMARY,
    detail: DATABASE_DETAIL,
    actions: [...DATABASE_ACTIONS]
});

const languageNoun = defineNoun({
    name: 'language',
    summary: LANGUAGE_SUMMARY,
    detail: LANGUAGE_DETAIL,
    actions: [...LANGUAGE_ACTIONS]
});

const templateNoun = defineNoun({
    name: 'template',
    summary: TEMPLATE_SUMMARY,
    detail: TEMPLATE_DETAIL,
    actions: [...TEMPLATE_ACTIONS]
});

const providerNoun = defineNoun({
    name: 'provider',
    summary: PROVIDER_SUMMARY,
    detail: PROVIDER_DETAIL,
    actions: [...PROVIDER_ACTIONS]
});

const taskNoun = defineNoun({
    name: 'task',
    summary:
        'Gives a task to an agent you opened, which wakes you with its result, and lists the tasks you gave and the one you were given; done reports the result of yours',
    detail: [
        'see\truimte-context agent --task\tgiving a task to an agent that is not open yet, which opens it',
        'see\truimte-context done\treporting the result of the task you were opened with'
    ],
    actions: [taskListAction, taskNewAction]
});

/* In the order `help` lists them, the verbs of their own before the nouns: everything `ruimte-context` does, whichever route serves it. */
export const VERBS: readonly VerbEntry[] = [
    helpVerb,
    listVerb,
    readVerb,
    doneVerb,
    notifyVerb,
    alertVerb,
    answerVerb,
    agentVerb,
    teamVerb,
    forkVerb,
    flagVerb,
    nodeNoun,
    linkNoun,
    browserNoun,
    deviceNoun,
    viewNoun,
    taskNoun,
    planVerb,
    visualNoun,
    artifactNoun,
    chatNoun,
    uiNoun,
    worktreeVerb,
    operationVerb,
    launchesNoun,
    routineNoun,
    secretNoun,
    projectNoun,
    databaseNoun,
    languageNoun,
    templateNoun,
    providerNoun,
    computerNoun
];

export function verbNamed(name: string): VerbEntry | undefined {
    return VERBS.find((verb) => verb.name === name);
}
