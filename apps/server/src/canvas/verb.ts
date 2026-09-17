import {
    isCanvasView,
    type AgentKind,
    type DiagramContent,
    type GitDiffResult,
    type ProjectCanvasView,
    type ProjectContent,
    type RuntimeMode,
    type Task,
    type Worktree,
    type WorktreeMergePayload,
    type WorktreeMergeResult
} from '@ruimte/contracts';
import { z } from 'zod';
import type { NoticeDelivery, Notice } from '../context/notices.ts';
import type { PlanStore } from '../plans/plan-store.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { ProjectMutation } from '../projects/project-store.ts';
import { parseArgv } from './argv.ts';

/* A verb said no. The code is for a script, the message for the agent, the lines for what it can pick instead. */
export class VerbRefusal extends Error {
    readonly code: string;
    readonly lines: string[];

    constructor(code: string, message: string, lines: string[] = []) {
        super(message);
        this.name = 'VerbRefusal';
        this.code = code;
        this.lines = lines;
    }
}

/* What a verb reaches the daemon through; an interface so a test can hand in a store of its own. */
export interface CanvasHost {
    locate(id: string): IndexedPlace | null;
    read(projectId: string): Promise<ProjectContent>;
    mutate<T>(projectId: string, apply: (content: ProjectContent) => ProjectMutation<T> | Promise<ProjectMutation<T>>): Promise<T>;
    /* The worktrees of the repository the folder is in; empty when it is not in one. */
    worktreePaths(folder: string): Promise<string[]>;
    /* The local branches of the repository the folder is in; null when it is in none. */
    branchesOf(folder: string): Promise<string[] | null>;
    /* The worktree of a branch under the machine's worktrees folder, made from HEAD when the branch is new. */
    addWorktree(folder: string, branch: string, projectId: string): Promise<{ worktree: Worktree; created: boolean }>;
    /* Writes the node a worktree was made for into the register, once the node exists. */
    claimWorktree(folder: string, path: string, nodeId: string): Promise<void>;
    /* Takes back a worktree this call made, when the write it was made for is refused. */
    removeWorktree(folder: string, path: string): Promise<unknown>;
    /* The widest mode an agent this node opens may run in: its own, as far as the daemon knows it. */
    modeOf(nodeId: string): RuntimeMode;
    /* The mode a person picked for terminal agents, from the clients connected now; undefined with none. */
    terminalModePreference(): RuntimeMode | undefined;
    /* The agent CLIs this machine has; a verb that starts one refuses the rest by name. */
    installedAgents(): Promise<AgentKind[]>;
    /* Holds the first prompt of a node against its id until the session or the chat for it is made. */
    holdPrompt(projectId: string, nodeId: string, prompt: string): Promise<void>;
    /* Owes the start of an agent node's chat or terminal, which the daemon makes whether or not a client shows the node. */
    startAgent(start: AgentStart): Promise<void>;
    /* How deep in the chain of agents opening agents this node sits; 0 for one a person opened. */
    depthOf(nodeId: string): number;
    /* The agent nodes this caller has opened and not lost, which is what caps one caller in a loop. */
    openedCount(callerId: string): number;
    /* Writes down who made a node and how deep it sits, outside the project and across a restart. */
    recordMade(record: { projectId: string; nodeId: string; openedBy: string; depth: number; agent: boolean }): Promise<void>;
    /* Who made a node, or null for one a person made; what `node delete` asks before it removes one. */
    madeBy(nodeId: string): string | null;
    /* Whether this machine lets an agent remove a view it did not make (`agentsDeleteAnyView` in `endpoint.json`). */
    agentsDeleteAnyView(): boolean;
    /* Tells every client to show this view of this project; false when nobody had it on screen to tell. */
    showView(projectId: string, viewId: string, by: string): boolean;
    /* Ends the shell or the CLI behind a node; a canvas that is removed takes its sessions with it. */
    endSession(kind: 'terminal' | 'chat', nodeId: string): Promise<void>;
    /* Puts a message in front of another node's agent, and says whether it landed or is waiting. */
    notify(notice: Omit<Notice, 'createdAt'>): Promise<NoticeDelivery>;
    /* Replaces the diagram of a view, whether or not anyone has its project open, and answers the new rev. */
    writeDiagram(projectId: string, viewId: string, content: DiagramContent): Promise<number>;
    /* The tasks a chat gives the nodes it opens with `--task`, kept by the daemon outside the project. */
    tasks: TaskHost;
    /* The plans of the caller's own chat, kept beside its record. */
    plans: Pick<PlanStore, 'read' | 'create' | 'apply' | 'delete'>;
    /* Reading and merging the worktrees of the project's repository; a host without git has none. */
    worktrees?: WorktreeHost;
}

export interface WorktreeHost {
    /* Every worktree of the repository a folder is in, with the work each holds. */
    list(folder: string): Promise<Worktree[]>;
    /* Everything a worktree holds over where it was made from, uncommitted and untracked files included. */
    diff(path: string, base: string | undefined): Promise<GitDiffResult>;
    /*
     * Merges a worktree under the limits an agent is held to: its loose work committed first, only
     * into a clean checkout, a conflict taken back and refused, no agent stopped and nothing removed.
     */
    merge(payload: Omit<WorktreeMergePayload, 'actionId' | 'stopAgent' | 'commitFirst' | 'into' | 'remove'>): Promise<WorktreeMergeResult>;
}

export interface TaskHost {
    /* `batchId` ties the tasks of one `team --task` call together, which wake the parent as one. */
    open(record: { projectId: string; parentId: string; childId: string; title: string; prompt: string; batchId?: string }): Promise<Task>;
    /* Ends the open task of this child with the result it reported; null when it has none open. */
    done(childId: string, text: string): Promise<Task | null>;
    /* Every task the node gave or was given, oldest first. */
    involving(nodeId: string): Task[];
}

export interface AgentStart {
    projectId: string;
    nodeId: string;
    /* The node that ran the verb; a chat hands its permission mode on to a chat it opens. */
    openedBy: string;
    node: 'chat' | 'terminal';
    provider: AgentKind;
    /* Where a client mounting the node would start it: its own directory, else the project folder. */
    cwd: string | null;
    /* The mode `--mode` asked for, and for a terminal the mode it was written down with; absent leaves a chat to the daemon. */
    runtimeMode?: RuntimeMode;
}

export interface VerbCall {
    /* The session or chat id the bearer token speaks for. */
    caller: string;
    host: CanvasHost;
}

export interface VerbHelp {
    name: string;
    usage: string;
    summary: string;
    /* The tab-separated lines `help` prints for this one: everything the one-line summary has no room for. */
    detail: readonly string[];
}

/* A word `POST /canvas/<verb>` runs on its own, such as `agent`: no noun in front of it. */
export interface Verb extends VerbHelp {
    served: 'canvas';
    /* The flags the parser takes, from the schema validation runs, so help and a test see the same list. */
    flagNames: readonly string[];
    /* Whether `--dry-run` means something here; only what makes something takes it. */
    dryRun: boolean;
    run(argv: readonly string[], call: VerbCall): Promise<string[]>;
}

/* The word after a noun, such as `rename` in `node rename`; `name` is both words, which is what a refusal and `help` say. */
export interface Action extends Omit<Verb, 'served'> {
    word: string;
}

/* A first word that only says what the action after it works on: `node`, `link`, `view`. */
export interface Noun {
    served: 'noun';
    name: string;
    /* `<list|new|...> ...`, read off the actions, so it cannot name one that is not there. */
    usage: string;
    summary: string;
    detail: readonly string[];
    actions: readonly Action[];
    run(argv: readonly string[], call: VerbCall): Promise<string[]>;
}

/* A word `ruimte-context` answers itself through `GET /context`; in the registry only so `help` names it. */
export interface ContextVerb extends VerbHelp {
    served: 'context';
}

export type VerbEntry = Verb | Noun | ContextVerb;

/* Two things an agent keeps mixing up, so the line is in the root of `help` and in the detail of each verb it is about. */
export const SCOPE_LINE =
    'scope\tlist and read are what a person linked into this session; node, link, view, task, agent, team, done, notify and worktree are the project itself, and plan is the chat of the caller\ta node you add is readable through read only once a line runs from it into you';

export const DRY_RUN_FLAG = 'dry-run';

/* Agents dry-run every call before the real one to be safe, which doubles what each costs them. */
export const DRY_RUN_PREVIEW = 'a refused call makes nothing either, so it is only a preview and never needed for safety';

/*
 * What takes `--dry-run`, filled as each is defined. Everything else refuses the flag by name and
 * points at these, so an agent never gets a silent nothing from a dry run that was never dry.
 */
const dryRunVerbs: string[] = [];

export const dryRunVerbNames = (): readonly string[] => dryRunVerbs;

interface ArgsSpec<Positionals extends z.ZodType, Flags extends z.ZodObject> {
    positionals: Positionals;
    /* Every flag is a string that takes a value; the keys of this object are the flags the parser knows. */
    flags: Flags;
    /* The flags that are on by being written and take no value of their own. */
    switches?: readonly string[];
    /* Whether this makes something and can therefore be asked to validate and stop. */
    dryRun?: boolean;
    run(input: { positionals: z.infer<Positionals>; flags: z.infer<Flags>; switches: ReadonlySet<string>; dryRun: boolean }, call: VerbCall): Promise<string[]>;
}

interface VerbSpec<Positionals extends z.ZodType, Flags extends z.ZodObject> extends VerbHelp, ArgsSpec<Positionals, Flags> {}

/* What a refusal over arguments points at; for an action `name` is both words, which is what `help` takes. */
const usageLinesOf = (name: string, usage: string): string[] => [`usage\t${name}\t${usage}`, `detail\truimte-context help ${name}`];

const flagsOf = (spec: ArgsSpec<z.ZodType, z.ZodObject>): { values: string[]; switches: string[] } => ({
    values: Object.keys(spec.flags.shape),
    switches: [...(spec.switches ?? []), ...(spec.dryRun === true ? [DRY_RUN_FLAG] : [])]
});

/* One set of arguments parsed and run. `name` is what a refusal calls it, so `view new` refuses under both its words. */
const runArgs = async <Positionals extends z.ZodType, Flags extends z.ZodObject>(
    name: string,
    usage: string,
    spec: ArgsSpec<Positionals, Flags>,
    argv: readonly string[],
    call: VerbCall
): Promise<string[]> => {
    const usageLines = usageLinesOf(name, usage);
    const { values, switches } = flagsOf(spec);
    const parsed = parseArgv(argv, values, switches);
    if (!parsed.ok) {
        if (parsed.code === 'unknown-flag' && argv.some((word) => word === `--${DRY_RUN_FLAG}` || word.startsWith(`--${DRY_RUN_FLAG}=`))) {
            throw new VerbRefusal(
                'no-dry-run',
                `${name} takes no --${DRY_RUN_FLAG}; only the verbs that make something do`,
                dryRunVerbs.map((verb) => `verb\t${verb}\ttakes --${DRY_RUN_FLAG}`)
            );
        }
        throw new VerbRefusal(parsed.code, parsed.message, usageLines);
    }
    const positionals = spec.positionals.safeParse(parsed.positionals);
    if (!positionals.success) {
        throw new VerbRefusal('bad-arguments', issueMessage(positionals.error, 'argument'), usageLines);
    }
    const flags = spec.flags.safeParse(parsed.flags);
    if (!flags.success) {
        throw new VerbRefusal('bad-arguments', issueMessage(flags.error, 'flag'), usageLines);
    }
    return spec.run({ positionals: positionals.data, flags: flags.data, switches: parsed.switches, dryRun: parsed.switches.has(DRY_RUN_FLAG) }, call);
};

/* What a verb and an action share: the synopsis beside the schemas its arguments are checked against. */
const defineArgs = <Positionals extends z.ZodType, Flags extends z.ZodObject>(name: string, spec: VerbSpec<Positionals, Flags>): Omit<Verb, 'served'> => {
    const { values, switches } = flagsOf(spec);
    if (spec.dryRun === true) {
        dryRunVerbs.push(name);
    }
    return {
        name,
        usage: spec.usage,
        summary: spec.summary,
        detail: spec.detail,
        flagNames: [...values, ...switches],
        dryRun: spec.dryRun === true,
        run: (argv, call) => runArgs(name, spec.usage, spec, argv, call)
    };
};

/*
 * One object per verb, holding its synopsis and the schemas its arguments are checked against, so
 * `help` renders from what validation runs and the two cannot drift apart.
 */
export const defineVerb = <Positionals extends z.ZodType, Flags extends z.ZodObject>(spec: VerbSpec<Positionals, Flags>): Verb => ({
    served: 'canvas',
    ...defineArgs(spec.name, spec)
});

/* `spec.name` is only the action's own word; the noun goes in front of it. */
export const defineAction = <Positionals extends z.ZodType, Flags extends z.ZodObject>(noun: string, spec: VerbSpec<Positionals, Flags>): Action => ({
    word: spec.name,
    ...defineArgs(`${noun} ${spec.name}`, spec)
});

/*
 * A noun and its actions. The table is the only source: the dispatch, the row in `help` and
 * everything `help <noun>` prints come out of it, so an action is documented by being defined.
 */
export const defineNoun = (spec: { name: string; summary: string; detail: readonly string[]; actions: readonly Action[] }): Noun => {
    const words = spec.actions.map((action) => action.word);
    return {
        served: 'noun',
        name: spec.name,
        usage: `<${words.join('|')}> ...`,
        summary: spec.summary,
        detail: spec.detail,
        actions: spec.actions,
        async run(argv, call) {
            const [word, ...rest] = argv;
            const action = spec.actions.find((candidate) => candidate.word === word);
            if (!action) {
                throw new VerbRefusal(
                    'unknown-action',
                    `${spec.name} needs one of ${words.join(', ')}${word === undefined ? '' : `, and ${word} is not one`}`,
                    [...spec.actions.map((candidate) => `usage\t${candidate.name}\t${candidate.usage}`), `detail\truimte-context help ${spec.name}`]
                );
            }
            return action.run(rest, call);
        }
    };
};

/*
 * Every schema in the registry carries a sentence of its own, because zod's default ("Too small:
 * expected array to have >=1 items") names neither what is missing nor what may go there.
 */
const issueMessage = (error: z.ZodError, what: 'argument' | 'flag'): string => error.issues[0]?.message ?? `Bad ${what}`;

/* The project the caller is in, from the index of every known project: an open one would miss an agent whose person switched away. */
export const placeOf = (call: VerbCall): IndexedPlace => {
    const place = call.host.locate(call.caller);
    if (!place) {
        throw new VerbRefusal('not-in-project', 'This session is not a node or a view of any project on this machine');
    }
    return place;
};

/* A field that goes into a tab-separated line; a tab or a newline in a title would split the row. */
export const field = (value: string): string => value.replace(/[\t\r\n]+/g, ' ');

/*
 * What a name on the canvas fits in: a node title, the label of a group, the word on a line. Past
 * this it is not a name any more but a paragraph in a header, in every list that prints it and in
 * the sidebar. Nothing about it is unique: two nodes may carry the same title, since an id is what
 * names a node and a title is what a person reads.
 */
export const MAX_TITLE_LENGTH = 120;

/* How much came in, for a refusal that counts: zod hands its error function the input it rejected. */
export const lengthOf = (input: unknown): number => {
    if (typeof input === 'string' || Array.isArray(input)) {
        return input.length;
    }
    return 0;
};

/* Said wherever a verb takes a name, since neither half of it can be read off the canvas. */
export const TITLE_LINE = `titles\tA name is at most ${MAX_TITLE_LENGTH} characters and is never unique: two nodes may carry the same one, and an id is what names a node`;

/* A flag a verb cannot do without: the same sentence whether it was left out or left empty, since
   zod's own ("expected string, received undefined") names neither the flag nor what goes in it. */
export const requiredField = (needs: string): z.ZodString => z.string({ error: needs }).min(1, needs);

/* One title schema for every verb that takes one, so the same limit is refused in the same sentence. */
export const titleField = (name: string, needs: string): z.ZodString =>
    z
        .string({ error: needs })
        .trim()
        .min(1, needs)
        .max(MAX_TITLE_LENGTH, {
            error: (issue) => `${name} is ${lengthOf(issue.input)} characters and at most ${MAX_TITLE_LENGTH} fit in a name on the canvas`
        });

/*
 * What a refusal lists, or one line saying the set is empty. A refusal that promises the groups of a
 * canvas and then prints nothing reads as a daemon that lost them, where the truth is that there are
 * none, which is a different thing to do something about.
 */
export const orNote = (lines: string[], note: string): string[] => (lines.length === 0 ? [`note\t${note}`] : lines);

export const canvasLines = (content: ProjectContent): string[] =>
    orNote(
        content.views.filter(isCanvasView).map((view) => `canvas\t${view.id}\t${field(view.name)}`),
        'This project has no canvas; a node only ever lands on one'
    );

/* What `agent` and `team` say when the caller is on no canvas: where the node goes is not all that changes. */
export const OPENING_OFF_CANVAS =
    'You are not a node on a canvas; name the canvas with --view, and what you open lands there without an edge from you, so the edge column shows -';

/*
 * The canvas a verb works on: the one `--view` names, else the one the caller is a node on. Ids
 * only, never names, so an agent cannot aim at a canvas by naming something else after it.
 */
export const canvasFor = (
    content: ProjectContent,
    place: IndexedPlace,
    view: string | undefined,
    offCanvas = 'This session is not on a canvas; name one with --view'
): ProjectCanvasView => {
    if (view !== undefined) {
        const named = content.views.find((candidate) => candidate.id === view);
        if (!named || !isCanvasView(named)) {
            throw new VerbRefusal('not-a-canvas', `${view} is not a canvas of this project`, canvasLines(content));
        }
        return named;
    }
    const own = place.canvasId === null ? undefined : content.views.find((candidate) => candidate.id === place.canvasId);
    if (!own || !isCanvasView(own)) {
        throw new VerbRefusal('view-required', offCanvas, canvasLines(content));
    }
    return own;
};
