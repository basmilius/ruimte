import { actionDescription } from '@ruimte/actions';
import { ChatSubagentSourceSchema, ContextSourceSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_SCREEN_LINES } from '../context/context-store.ts';
// First: verbs join the --dry-run list as they are defined, and node new has always led it.
import { nodeDeleteAction, nodeListAction, nodeNewAction } from './node-verb.ts';
import { agentVerb } from './agent-verb.ts';
import { arrangeAction } from './arrange-verb.ts';
import { BROWSER_ACTIONS, BROWSER_DETAIL, BROWSER_SUMMARY } from './browser-verb.ts';
import { diagramAction } from './diagram-verb.ts';
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
import {
    DRY_RUN_FLAG,
    DRY_RUN_PREVIEW,
    SCOPE_LINE,
    VerbRefusal,
    defineNoun,
    defineVerb,
    dryRunVerbNames,
    type ContextVerb,
    type Noun,
    type VerbEntry
} from './verb.ts';

/* The one line about failure every help output ends with; the codes are the CLI's, which is what runs the verb. */
const REFUSAL_LINE =
    'refusal\trefused<TAB><code><TAB><message> on stderr, then what you can pick instead\texit 0 done, 1 the daemon failed, 2 not in a live Ruimte session, 3 refused';

/* Agents repeat ids to people, who know nodes, views and plans only by their titles. */
const IDS_LINE = 'ids\tIds in this output are for your commands. When you talk to the person, name things by their title, never by id';

/* Said once under the list, since the flag is on some actions and refused by name on the rest. */
const dryRunLine = (): string =>
    `dry run\t--${DRY_RUN_FLAG}\t${dryRunVerbNames().join(', ')}\tsame checks, nothing made; ${DRY_RUN_PREVIEW}; every other verb refuses the flag`;

/*
 * Every row says what it is in its first field, so the lines under the list are never read as verbs.
 * A noun names its actions and not their arguments, which keeps the root short; `help <noun>` has those.
 */
export const verbSummaryLines = (): string[] =>
    VERBS.map((entry) =>
        entry.served === 'noun'
            ? `noun\t${entry.name}\t${entry.actions.map((action) => action.word).join('|')}\t${entry.summary}`
            : `verb\t${entry.name}\t${entry.usage}\t${entry.summary}`
    );

/* The signatures of every action of a noun, for `help <noun>` and a refusal about one. */
const actionLines = (noun: Noun): string[] => noun.actions.map((action) => `action\t${action.name}\t${action.usage}\t${action.summary}`);

const detailLines = (entry: { name: string; usage: string; summary: string; detail: readonly string[] }): string[] => [
    `usage\t${entry.name}\t${entry.usage}`,
    `about\t${entry.summary}`,
    ...entry.detail,
    REFUSAL_LINE
];

const nounLines = (noun: Noun): string[] => [
    `usage\t${noun.name}\t${noun.usage}`,
    `about\t${noun.summary}`,
    ...noun.detail,
    ...actionLines(noun),
    `detail\truimte-context help ${noun.name} <action>\tone action in full`,
    REFUSAL_LINE
];

const helpVerb = defineVerb({
    name: 'help',
    usage: '[noun] [action]',
    summary: 'Lists every verb and noun; with a noun the signature of each of its actions, with a noun and an action or with a verb everything that one takes',
    detail: [
        'argument\t<noun>\toptional\tThe noun or verb to detail; without one every verb and noun is listed',
        'argument\t<action>\toptional\tOne action of that noun, in full',
        'prints\tverb\tname\targuments\tsummary\tone row per verb',
        'prints\tnoun\tname\tactions\tsummary\tone row per noun, its actions separated by |; a row that starts with neither is not one'
    ],
    positionals: z.array(z.string()).max(2, 'help takes a verb, or a noun and one of its actions, and nothing else'),
    flags: z.object({}),
    run: async ({ positionals: [name, actionWord] }) => {
        if (name === undefined) {
            return [
                ...verbSummaryLines(),
                SCOPE_LINE,
                IDS_LINE,
                dryRunLine(),
                'detail\truimte-context help <noun>\tthe signature of every action of a noun',
                'detail\truimte-context help <noun> <action>\tone action in full',
                'detail\truimte-context help <verb>\tone verb in full',
                REFUSAL_LINE
            ];
        }
        const entry = verbNamed(name);
        if (!entry) {
            throw new VerbRefusal('unknown-verb', `${name} is not a verb or a noun`, [
                'detail\truimte-context help\tevery verb and noun, with what each takes',
                ...verbSummaryLines()
            ]);
        }
        if (entry.served !== 'noun') {
            if (actionWord !== undefined) {
                throw new VerbRefusal('bad-arguments', `${name} is a verb and has no actions; ruimte-context help ${name} details it`, [
                    `detail\truimte-context help ${name}\tone verb in full`
                ]);
            }
            return detailLines(entry);
        }
        if (actionWord === undefined) {
            return nounLines(entry);
        }
        const action = entry.actions.find((candidate) => candidate.word === actionWord);
        if (!action) {
            throw new VerbRefusal('unknown-action', `${actionWord} is not an action of ${name}`, actionLines(entry));
        }
        return detailLines(action);
    }
});

const listVerb: ContextVerb = {
    served: 'context',
    name: 'list',
    usage: '',
    summary: `${actionDescription('context.list', 'agent')} Also what ruimte-context prints without a verb.`,
    detail: [
        'prints\tid\tkind\ttitle\tone line per linked source, nothing when the person linked none',
        `kinds\t${ContextSourceSchema.shape.kind.options.join('\t')}\ta note and a text on the canvas both arrive as text`,
        'note\tThe id is what ruimte-context read takes; this list is the whole of what you may read',
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
        'argument\t<id>\trequired\tThe id of a source, from ruimte-context list; a drawing or diagram also takes the id of the linked node that shows it',
        'flag\t--tail N\toptional\tOnly the last N lines, N a positive whole number; without it the whole source',
        `flag\t--subagent T\toptional\tThe whole conversation of one subagent of a linked chat instead of the chat, T the id in its > Subagent line; read from ${ChatSubagentSourceSchema.options.join(' or ')}; --tail counts lines of that conversation`,
        'prints\tThe source itself, as text, not as tab-separated lines',
        'kind\ttext\tThe text the person wrote: a note or a text on the canvas\t--tail counts its lines',
        `kind\tterminal\tThe screen of that session, its last ${MAX_SCREEN_LINES} lines, read the moment you ask\t--tail counts screen lines and cannot reach past those ${MAX_SCREEN_LINES}`,
        'kind\tchat\tThe plans of that chat as text, then the whole thread as markdown: who said what, what every tool ran, and one line per subagent with the id --subagent takes\t--tail counts lines of the thread and leaves the plans out',
        'kind\tdrawing\tThe text of the drawing in reading order, and the picture itself as SVG under it\t--tail counts lines of the reading order and leaves the SVG out',
        'kind\tdiagram\tIts title, every node layer by layer (sub in brackets), every edge with its label, what each group wraps, and the SVG under it\t--tail counts lines of that list and leaves the SVG out',
        'kind\tfile\tIts path and a line telling you to read it yourself, since your own tools see a fresher copy\t--tail does nothing here',
        'kind\tbrowser\tThe address of the page and, under it, the text of that page as this machine has it open, read the moment you ask; the address alone when no page of it is open here\t--tail counts lines of the page text and keeps the address',
        'kind\tbrowser\tReading leaves the page where it is; ruimte-context browser is what sends it somewhere, over the same line',
        'kind\tdevice\tWhich device the node points at: its name, platform, kind and runtime, and the state, deviceId and backendId this machine knows it by, or a line saying the device is not here right now\t--tail does nothing here',
        'cheap\tThe last fifteen lines of a neighbour is usually the whole answer; read the source whole only when it is not',
        'direction\tA line runs one way: the one you draw into another agent lets it read you, and reading it back takes a line from it into you, which ruimte-context link new --from <id> --to <you> draws',
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
    summary: 'Lists, draws and removes the lines of a canvas, which is what lets an agent read the node a line runs from',
    detail: [SCOPE_LINE],
    actions: [linkListAction, linkNewAction, linkDeleteAction]
});

const browserNoun = defineNoun({
    name: 'browser',
    summary: BROWSER_SUMMARY,
    detail: BROWSER_DETAIL,
    actions: [...BROWSER_ACTIONS]
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
    agentVerb,
    teamVerb,
    nodeNoun,
    linkNoun,
    browserNoun,
    viewNoun,
    taskNoun,
    planVerb,
    worktreeVerb,
    operationVerb
];

export const verbNamed = (name: string): VerbEntry | undefined => VERBS.find((verb) => verb.name === name);
