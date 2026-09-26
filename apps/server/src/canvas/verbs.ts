import { alertVerb } from './alert-verb.ts';
import { actionDescription } from '@ruimte/actions';
import { ChatSubagentSourceSchema, ContextSourceSchema } from '@ruimte/contracts';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
// First: verbs join the --dry-run list as they are defined, and node new has always led it.
import { nodeDeleteAction, nodeListAction, nodeNewAction } from './node-verb.ts';
import { agentVerb } from './agent-verb.ts';
import { answerVerb } from './answer-verb.ts';
import { arrangeAction } from './arrange-verb.ts';
import { BROWSER_ACTIONS, BROWSER_DETAIL, BROWSER_SUMMARY } from './browser-verb.ts';
import { COMPUTER_ACTIONS, COMPUTER_DETAIL, COMPUTER_SUMMARY } from './computer-verb.ts';
import { DEVICE_ACTIONS, DEVICE_DETAIL, DEVICE_SUMMARY } from './device-verb.ts';
import { diagramAction } from './diagram-verb.ts';
import { flagVerb } from './flag-verb.ts';
import { nodeEditAction } from './edit-verb.ts';
import { groupAction } from './group-verb.ts';
import { linkDeleteAction, linkListAction, linkNewAction } from './link-verb.ts';
import { notifyVerb } from './notify-verb.ts';
import { openAction } from './open-verb.ts';
import { operationVerb } from './operation-verb.ts';
import { planVerb } from './plan-verb.ts';
import { renameAction } from './rename-verb.ts';
import { doneVerb, taskListAction, taskNewAction } from './task-verbs.ts';
import { teamVerb } from './team-verb.ts';
import { VIEW_ACTIONS, VIEW_DETAIL, VIEW_SUMMARY } from './view-verb.ts';
import { worktreeVerb } from './worktree-verb.ts';
import { summaryLines } from '@ruimte/agents/context/verb';
import { SCOPE_LINE, defineHelp, defineNoun, dryRunLine, type ContextVerb, type VerbCall, type VerbEntry } from './verb.ts';

/* The one line about failure every help output ends with; the codes are the CLI's, which is what runs the verb. */
const REFUSAL_LINE =
    'refusal\trefused<TAB><code><TAB><message> on stderr, then what you can pick instead\texit 0 done, 1 the daemon failed, 2 not in a live Ruimte session, 3 refused';

/* Agents repeat ids to people, who know nodes, views and plans only by their titles. */
const IDS_LINE = 'ids\tIds in this output are for your commands. When you talk to the person, name things by their title, never by id';

export const verbSummaryLines = (): string[] => summaryLines<VerbCall>(VERBS);

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
        'prints\tid\tkind\ttitle\tflag\tone line per linked source, nothing when the person linked none; flag is the color the person flagged it with, or -',
        `kinds\t${ContextSourceSchema.shape.kind.options.join('\t')}\ta note and a text on the canvas both arrive as text`,
        'note\tThe id is what ruimte-context read takes; this list is what your lines let you read, and besides it only a chat a person attached to your message and an agent you opened yourself',
        'note\tA line from a group lists what lies inside that frame, each on a line of its own, a frame inside it included; the group itself is never a line here',
        SCOPE_LINE
    ]
};

const readVerb: ContextVerb = {
    served: 'context',
    name: 'read',
    usage: '<id> [--tail N] [--subagent T]',
    summary: actionDescription('context.read', 'agent'),
    detail: [
        'argument\t<id>\trequired\tThe id of a source, from ruimte-context list, or of an agent you opened yourself; a drawing or diagram also takes the id of the linked node that shows it',
        'flag\t--tail N\toptional\tOnly the last N lines, N a positive whole number; without it the whole source',
        `flag\t--subagent T\toptional\tThe whole conversation of one subagent of a chat you may read instead of the chat, T the id in its > Subagent line; read from ${ChatSubagentSourceSchema.options.join(' or ')}; --tail counts lines of that conversation`,
        'prints\tThe source itself, as text, not as tab-separated lines',
        'kind\ttext\tThe text the person wrote: a note or a text on the canvas\t--tail counts its lines',
        `kind\tterminal\tThe screen of that session, its last ${MAX_SCREEN_LINES} lines, read the moment you ask\t--tail counts screen lines and cannot reach past those ${MAX_SCREEN_LINES}`,
        'kind\tchat\tThe plans of that chat as text, then the whole thread as markdown: who said what, what every tool ran, and one line per subagent with the id --subagent takes\t--tail counts lines of the thread and leaves the plans out',
        'kind\tchat\tA Workflow call has one line per phase under its > Tool line, each agent of that phase with its state and the id --subagent takes',
        'kind\tchat\tA question or an approval in the thread is one > Question or > Approval line with its state and its request id; a question that still waits lists its question ids and choices under it, which is what ruimte-context answer takes',
        'kind\tchat\tA chat the person attached to one of your messages reads the same way, by the id that message named, with no line to it and without showing up in ruimte-context list',
        'own\tAn agent you opened yourself, with agent or team, reads by its id with no line from it into you and without showing up in ruimte-context list, --tail and --subagent included; an agent it opened in turn is its to read, not yours',
        'kind\tdrawing\tThe text of the drawing in reading order, and the picture itself as SVG under it\t--tail counts lines of the reading order and leaves the SVG out',
        'kind\tdiagram\tIts title, every node layer by layer (sub in brackets), every edge with its label, what each group wraps, and the SVG under it\t--tail counts lines of that list and leaves the SVG out',
        'kind\tfile\tIts path and a line telling you to read it yourself, since your own tools see a fresher copy\t--tail does nothing here',
        'kind\tbrowser\tThe address of the page and, under it, the text of that page as this machine has it open, read the moment you ask; the address alone when no page of it is open here\t--tail counts lines of the page text and keeps the address',
        'kind\tbrowser\tReading leaves the page where it is; ruimte-context browser is what sends it somewhere, over the same line',
        'kind\tdevice\tWhich device the node points at: its name, platform, kind and runtime, and the state, deviceId and backendId this machine knows it by, or a line saying the device is not here right now\t--tail does nothing here',
        'kind\tdevice\tReading leaves the device alone; ruimte-context device is what photographs and operates it, over the same line',
        'cheap\tThe last fifteen lines of a neighbour is usually the whole answer; read the source whole only when it is not',
        'direction\tBetween two agents a line runs one way: the one you draw into another agent lets it read you, and reading it back takes a line from it into you, which ruimte-context link new --from <id> --to <you> draws; an agent you opened yourself needs none',
        'direction\tA node that is no agent, a note, a page, a file, a drawing or a diagram, you read over a line whichever way that line runs',
        'refusals\tnot-linked\tunreadable\tunknown-source\tunknown-subagent\tbad-arguments\tthe whole set this verb refuses with',
        SCOPE_LINE
    ]
};

const nodeNoun = defineNoun({
    name: 'node',
    summary: 'Lists, adds, writes in, renames, removes, frames and lays out the nodes of a canvas',
    detail: [
        'note\tA node is a note, a browser, a drawing, a diagram, a file, a terminal, a chat or a group on a canvas; agent and team add agent nodes that start working',
        SCOPE_LINE
    ],
    actions: [nodeListAction, nodeNewAction, nodeEditAction, renameAction, nodeDeleteAction, groupAction, arrangeAction]
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
    actions: [...VIEW_ACTIONS, openAction, diagramAction]
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
    flagVerb,
    nodeNoun,
    linkNoun,
    browserNoun,
    deviceNoun,
    viewNoun,
    taskNoun,
    planVerb,
    worktreeVerb,
    operationVerb,
    computerNoun
];

export const verbNamed = (name: string): VerbEntry | undefined => VERBS.find((verb) => verb.name === name);
