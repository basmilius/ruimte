import { isCanvasView, type AgentKind, type ProjectCanvasView, type ProjectContent } from '@ruimte/contracts';
import type { z } from 'zod';
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
    /* The agent CLIs this machine has; a verb that starts one refuses the rest by name. */
    installedAgents(): Promise<AgentKind[]>;
    /* Holds the first prompt of a node against its id until the session or the chat for it is made. */
    holdPrompt(projectId: string, nodeId: string, prompt: string): Promise<void>;
    /* How deep in the chain of agents opening agents this node sits; 0 for one a person opened. */
    depthOf(nodeId: string): number;
    /* The agent nodes this caller has opened and not lost, which is what caps one caller in a loop. */
    openedCount(callerId: string): number;
    /* Writes down who opened a node and how deep it sits, outside the project and across a restart. */
    recordOpened(projectId: string, nodeId: string, openedBy: string, depth: number): Promise<void>;
}

export interface VerbCall {
    /* The session or chat id the bearer token speaks for. */
    caller: string;
    host: CanvasHost;
}

interface VerbHelp {
    name: string;
    usage: string;
    summary: string;
    /* The tab-separated lines `help <verb>` prints: everything the one-line summary has no room for. */
    detail: readonly string[];
}

/* A verb `POST /canvas/<verb>` runs. */
export interface Verb extends VerbHelp {
    served: 'canvas';
    /* The flags the parser takes, from the schema validation runs, so help and a test see the same list. */
    flagNames: readonly string[];
    /* Whether `--dry-run` means something here; only the verbs that make something take it. */
    dryRun: boolean;
    run(argv: readonly string[], call: VerbCall): Promise<string[]>;
}

/* A word `ruimte-context` answers itself through `GET /context`; in the registry only so `help` names it. */
export interface ContextVerb extends VerbHelp {
    served: 'context';
}

export type VerbEntry = Verb | ContextVerb;

export const DRY_RUN_FLAG = 'dry-run';

/*
 * The verbs that take `--dry-run`, filled as each is defined. A verb that does not take it refuses
 * the flag by name and points at the ones that do, so an agent never gets a silent nothing from a
 * dry run that was never dry.
 */
const dryRunVerbs: string[] = [];

export const dryRunVerbNames = (): readonly string[] => dryRunVerbs;

interface VerbSpec<Positionals extends z.ZodType, Flags extends z.ZodObject> {
    name: string;
    usage: string;
    summary: string;
    detail: readonly string[];
    positionals: Positionals;
    /* Every flag is a string that takes a value; the keys of this object are the flags the parser knows. */
    flags: Flags;
    /* The flags that are on by being written and take no value of their own. */
    switches?: readonly string[];
    /* Whether this verb makes something and can therefore be asked to validate and stop. */
    dryRun?: boolean;
    run(input: { positionals: z.infer<Positionals>; flags: z.infer<Flags>; switches: ReadonlySet<string>; dryRun: boolean }, call: VerbCall): Promise<string[]>;
}

/*
 * One object per verb, holding its synopsis and the schemas its arguments are checked against, so
 * `help` renders from what validation runs and the two cannot drift apart.
 */
export const defineVerb = <Positionals extends z.ZodType, Flags extends z.ZodObject>(spec: VerbSpec<Positionals, Flags>): Verb => {
    const usageLines = [`usage\t${spec.name}\t${spec.usage}`, `detail\truimte-context help ${spec.name}`];
    const flagNames = Object.keys(spec.flags.shape);
    const switches = [...(spec.switches ?? []), ...(spec.dryRun === true ? [DRY_RUN_FLAG] : [])];
    if (spec.dryRun === true) {
        dryRunVerbs.push(spec.name);
    }
    return {
        served: 'canvas',
        name: spec.name,
        usage: spec.usage,
        summary: spec.summary,
        detail: spec.detail,
        flagNames: [...flagNames, ...switches],
        dryRun: spec.dryRun === true,
        async run(argv, call) {
            const parsed = parseArgv(argv, flagNames, switches);
            if (!parsed.ok) {
                if (parsed.code === 'unknown-flag' && argv.some((word) => word === `--${DRY_RUN_FLAG}` || word.startsWith(`--${DRY_RUN_FLAG}=`))) {
                    throw new VerbRefusal(
                        'no-dry-run',
                        `${spec.name} takes no --${DRY_RUN_FLAG}; only the verbs that make something do`,
                        dryRunVerbs.map((name) => `verb\t${name}\ttakes --${DRY_RUN_FLAG}`)
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

/*
 * The canvas a verb works on: the one `--view` names, else the one the caller is a node on. Ids
 * only, never names, so an agent cannot aim at a canvas by naming something else after it.
 */
export const canvasFor = (content: ProjectContent, place: IndexedPlace, view: string | undefined): ProjectCanvasView => {
    if (view !== undefined) {
        const named = content.views.find((candidate) => candidate.id === view);
        if (!named || !isCanvasView(named)) {
            throw new VerbRefusal('not-a-canvas', `${view} is not a canvas of this project`, canvasLines(content));
        }
        return named;
    }
    const own = place.canvasId === null ? undefined : content.views.find((candidate) => candidate.id === place.canvasId);
    if (!own || !isCanvasView(own)) {
        throw new VerbRefusal('view-required', 'This session is not on a canvas; name one with --view', canvasLines(content));
    }
    return own;
};
