import { isCanvasView, type ProjectCanvasView, type ProjectContent } from '@ruimte/contracts';
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
    run(argv: readonly string[], call: VerbCall): Promise<string[]>;
}

/* A word `ruimte-context` answers itself through `GET /context`; in the registry only so `help` names it. */
export interface ContextVerb extends VerbHelp {
    served: 'context';
}

export type VerbEntry = Verb | ContextVerb;

interface VerbSpec<Positionals extends z.ZodType, Flags extends z.ZodObject> {
    name: string;
    usage: string;
    summary: string;
    detail: readonly string[];
    positionals: Positionals;
    /* Every flag is a string that takes a value; the keys of this object are the flags the parser knows. */
    flags: Flags;
    run(input: { positionals: z.infer<Positionals>; flags: z.infer<Flags> }, call: VerbCall): Promise<string[]>;
}

/*
 * One object per verb, holding its synopsis and the schemas its arguments are checked against, so
 * `help` renders from what validation runs and the two cannot drift apart.
 */
export const defineVerb = <Positionals extends z.ZodType, Flags extends z.ZodObject>(spec: VerbSpec<Positionals, Flags>): Verb => {
    const usageLines = [`usage\t${spec.name}\t${spec.usage}`, `detail\truimte-context help ${spec.name}`];
    const flagNames = Object.keys(spec.flags.shape);
    return {
        served: 'canvas',
        name: spec.name,
        usage: spec.usage,
        summary: spec.summary,
        detail: spec.detail,
        flagNames,
        async run(argv, call) {
            const parsed = parseArgv(argv, flagNames);
            if (!parsed.ok) {
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
            return spec.run({ positionals: positionals.data, flags: flags.data }, call);
        }
    };
};

const issueMessage = (error: z.ZodError, what: 'argument' | 'flag'): string => {
    const issue = error.issues[0];
    if (!issue) {
        return `Bad ${what}`;
    }
    const at = issue.path.length === 0 ? '' : what === 'flag' ? `--${String(issue.path[0])}: ` : `${what} ${Number(issue.path[0]) + 1}: `;
    return `${at}${issue.message}`;
};

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

export const canvasLines = (content: ProjectContent): string[] => content.views.filter(isCanvasView).map((view) => `canvas\t${view.id}\t${field(view.name)}`);

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
