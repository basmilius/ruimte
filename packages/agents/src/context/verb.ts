import { z } from 'zod';
import { CodedError } from '../coded-error.ts';
import { parseArgv } from './argv.ts';

/* A verb said no. The code is for a script, the message for the agent, the lines for what it can pick instead. */
export class VerbRefusal extends CodedError {}

/* What every call carries, whatever else an app puts in it. */
export interface VerbCallBase {
    /* What `--revision` named: the revision of the document the caller read before it decided on this write. */
    expectedRevision?: number;
}

export interface VerbHelp {
    name: string;
    usage: string;
    summary: string;
    /* The tab-separated lines `help` prints for this one: everything the one-line summary has no room for. */
    detail: readonly string[];
}

/* A word that runs on its own, such as `help`: no noun in front of it. */
export interface Verb<Call extends VerbCallBase> extends VerbHelp {
    served: 'verb';
    /* The flags the parser takes, from the schema validation runs, so help and a test see the same list. */
    flagNames: readonly string[];
    /* Whether `--dry-run` means something here; only what makes something takes it. */
    dryRun: boolean;
    run(argv: readonly string[], call: Call): Promise<string[]>;
}

/* The word after a noun, such as `rename` in `node rename`; `name` is both words, which is what a refusal and `help` say. */
export interface Action<Call extends VerbCallBase> extends Omit<Verb<Call>, 'served'> {
    word: string;
}

/* A first word that only says what the action after it works on: `node`, `link`, `view`. */
export interface Noun<Call extends VerbCallBase> {
    served: 'noun';
    name: string;
    /* `<list|new|...> ...`, read off the actions, so it cannot name one that is not there. */
    usage: string;
    summary: string;
    detail: readonly string[];
    actions: readonly Action<Call>[];
    run(argv: readonly string[], call: Call): Promise<string[]>;
}

/* A word the CLI answers on a route of its own, such as Ruimte's `list` and `read`; in the registry so `help` names it. */
export interface ContextVerb extends VerbHelp {
    served: 'context';
}

export type VerbEntry<Call extends VerbCallBase> = Verb<Call> | Noun<Call> | ContextVerb;

export const DRY_RUN_FLAG = 'dry-run';

export const REVISION_FLAG = 'revision';

/* Agents dry-run every call before the real one to be safe, which doubles what each costs them. */
export const DRY_RUN_PREVIEW = 'a refused call makes nothing either, so it is only a preview and never needed for safety';

export interface ArgsSpec<Positionals extends z.ZodType, Flags extends z.ZodObject, Call extends VerbCallBase> {
    positionals: Positionals;
    /* Every flag is a string that takes a value; the keys of this object are the flags the parser knows. */
    flags: Flags;
    /* The flags that are on by being written and take no value of their own. */
    switches?: readonly string[];
    /* Whether this makes something and can therefore be asked to validate and stop. */
    dryRun?: boolean;
    /* Whether this writes a document and so takes the revision it was decided on. */
    revision?: boolean;
    run(input: { positionals: z.infer<Positionals>; flags: z.infer<Flags>; switches: ReadonlySet<string>; dryRun: boolean }, call: Call): Promise<string[]>;
}

export interface VerbSpec<Positionals extends z.ZodType, Flags extends z.ZodObject, Call extends VerbCallBase>
    extends VerbHelp, ArgsSpec<Positionals, Flags, Call> {}

export interface NounSpec<Call extends VerbCallBase> {
    name: string;
    summary: string;
    detail: readonly string[];
    actions: readonly Action<Call>[];
}

export interface HelpSpec<Call extends VerbCallBase> {
    /* A function, since the help verb is itself one of the entries it lists. */
    entries(): readonly VerbEntry<Call>[];
    /* The lines the root of `help` prints between the list and its pointers to the rest. */
    root(): readonly string[];
    /* The one line about failure every help output ends with: how the CLI prints a refusal and what it exits with. */
    refusal: string;
}

export interface VerbRegistry<Call extends VerbCallBase> {
    /*
     * One object per verb, holding its synopsis and the schemas its arguments are checked against, so
     * `help` renders from what validation runs and the two cannot drift apart.
     */
    defineVerb<Positionals extends z.ZodType, Flags extends z.ZodObject>(spec: VerbSpec<Positionals, Flags, Call>): Verb<Call>;
    /* `spec.name` is only the action's own word; the noun goes in front of it. */
    defineAction<Positionals extends z.ZodType, Flags extends z.ZodObject>(noun: string, spec: VerbSpec<Positionals, Flags, Call>): Action<Call>;
    /*
     * A noun and its actions. The table is the only source: the dispatch, the row in `help` and
     * everything `help <noun>` prints come out of it, so an action is documented by being defined.
     */
    defineNoun(spec: NounSpec<Call>): Noun<Call>;
    /* The `help` verb over every entry, rendered from the same objects the dispatch runs. */
    defineHelp(spec: HelpSpec<Call>): Verb<Call>;
    /* What takes `--dry-run`, in the order each was defined. */
    dryRunVerbNames(): readonly string[];
    /* Said once under the list in `help`, since the flag is on some actions and refused by name on the rest. */
    dryRunLine(): string;
}

const flagsOf = <Call extends VerbCallBase>(spec: ArgsSpec<z.ZodType, z.ZodObject, Call>): { values: string[]; switches: string[] } => ({
    values: [...Object.keys(spec.flags.shape), ...(spec.revision === true ? [REVISION_FLAG] : [])],
    switches: [...(spec.switches ?? []), ...(spec.dryRun === true ? [DRY_RUN_FLAG] : [])]
});

const flagSpelled = (usage: string, flag: string): boolean => new RegExp(`(^|[^\\w-])${flag}(?![\\w-])`).test(usage);

/*
 * The synopsis with every flag the detail documents: what the hand-written one leaves out is added
 * from its detail line, bracketed unless that line says it is required, so the two never drift.
 */
const usageWithFlags = (usage: string, detail: readonly string[]): string => {
    const missing = detail
        .filter((line) => line.startsWith('flag\t--'))
        .map((line) => line.split('\t'))
        .filter(([, syntax]) => !flagSpelled(usage, syntax!.split(' ')[0]!))
        .map(([, syntax, need]) => (need === 'required' ? syntax! : `[${syntax}]`));
    return [usage, ...missing].filter((part) => part !== '').join(' ');
};

/*
 * Every schema in the registry carries a sentence of its own, because zod's default ("Too small:
 * expected array to have >=1 items") names neither what is missing nor what may go there.
 */
const issueMessage = (error: z.ZodError, what: 'argument' | 'flag'): string => error.issues[0]?.message ?? `Bad ${what}`;

/*
 * Every row says what it is in its first field, so the lines under the list are never read as verbs.
 * A noun names its actions and not their arguments, which keeps the root short; `help <noun>` has those.
 */
export const summaryLines = <Call extends VerbCallBase>(entries: readonly VerbEntry<Call>[]): string[] =>
    entries.map((entry) =>
        entry.served === 'noun'
            ? `noun\t${entry.name}\t${entry.actions.map((action) => action.word).join('|')}\t${entry.summary}`
            : `verb\t${entry.name}\t${entry.usage}\t${entry.summary}`
    );

/* The signatures of every action of a noun, for `help <noun>` and a refusal about one. */
const actionLines = <Call extends VerbCallBase>(noun: Noun<Call>): string[] =>
    noun.actions.map((action) => `action\t${action.name}\t${action.usage}\t${action.summary}`);

/* `cli` is the command an agent runs, such as `ruimte-context`, which every pointer to `help` names. */
export const createVerbRegistry = <Call extends VerbCallBase>(options: { cli: string }): VerbRegistry<Call> => {
    const { cli } = options;
    /*
     * What takes `--dry-run`, filled as each is defined. Everything else refuses the flag by name and
     * points at these, so an agent never gets a silent nothing from a dry run that was never dry.
     */
    const dryRunVerbs: string[] = [];

    /* What a refusal over arguments points at; for an action `name` is both words, which is what `help` takes. */
    const usageLinesOf = (name: string, usage: string): string[] => [`usage\t${name}\t${usage}`, `detail\t${cli} help ${name}`];

    /* One set of arguments parsed and run. `name` is what a refusal calls it, so `view new` refuses under both its words. */
    const runArgs = async <Positionals extends z.ZodType, Flags extends z.ZodObject>(
        name: string,
        usage: string,
        spec: ArgsSpec<Positionals, Flags, Call>,
        argv: readonly string[],
        call: Call
    ): Promise<string[]> => {
        const usageLines = usageLinesOf(name, usage);
        const { values, switches } = flagsOf(spec);
        const parsed = parseArgv(argv, values, switches);
        if (!parsed.ok) {
            const dryRunAsked = argv.some((word) => word === `--${DRY_RUN_FLAG}` || word.startsWith(`--${DRY_RUN_FLAG}=`));
            if (parsed.code === 'unknown-flag' && spec.dryRun !== true && dryRunAsked) {
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
        const { [REVISION_FLAG]: revision, ...given } = parsed.flags;
        const flags = spec.flags.safeParse(given);
        if (!flags.success) {
            throw new VerbRefusal('bad-arguments', issueMessage(flags.error, 'flag'), usageLines);
        }
        if (revision !== undefined && !/^\d+$/.test(revision)) {
            throw new VerbRefusal('bad-arguments', `--${REVISION_FLAG} takes the whole number a list printed as revision`, usageLines);
        }
        return spec.run(
            { positionals: positionals.data, flags: flags.data, switches: parsed.switches, dryRun: parsed.switches.has(DRY_RUN_FLAG) },
            revision === undefined ? call : { ...call, expectedRevision: Number(revision) }
        );
    };

    /* What a verb and an action share: the synopsis beside the schemas its arguments are checked against. */
    const defineArgs = <Positionals extends z.ZodType, Flags extends z.ZodObject>(
        name: string,
        spec: VerbSpec<Positionals, Flags, Call>
    ): Omit<Verb<Call>, 'served'> => {
        const { values, switches } = flagsOf(spec);
        if (spec.dryRun === true) {
            dryRunVerbs.push(name);
        }
        const usage = usageWithFlags(spec.usage, spec.detail);
        return {
            name,
            usage,
            summary: spec.summary,
            detail: spec.detail,
            flagNames: [...new Set([...values, ...switches])],
            dryRun: spec.dryRun === true,
            run: (argv, call) => runArgs(name, usage, spec, argv, call)
        };
    };

    const defineVerb = <Positionals extends z.ZodType, Flags extends z.ZodObject>(spec: VerbSpec<Positionals, Flags, Call>): Verb<Call> => ({
        served: 'verb',
        ...defineArgs(spec.name, spec)
    });

    const defineAction = <Positionals extends z.ZodType, Flags extends z.ZodObject>(noun: string, spec: VerbSpec<Positionals, Flags, Call>): Action<Call> => ({
        word: spec.name,
        ...defineArgs(`${noun} ${spec.name}`, spec)
    });

    const defineNoun = (spec: NounSpec<Call>): Noun<Call> => {
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
                        [...spec.actions.map((candidate) => `usage\t${candidate.name}\t${candidate.usage}`), `detail\t${cli} help ${spec.name}`]
                    );
                }
                return action.run(rest, call);
            }
        };
    };

    const defineHelp = (spec: HelpSpec<Call>): Verb<Call> => {
        const detailLines = (entry: VerbHelp): string[] => [`usage\t${entry.name}\t${entry.usage}`, `about\t${entry.summary}`, ...entry.detail, spec.refusal];
        const nounLines = (noun: Noun<Call>): string[] => [
            `usage\t${noun.name}\t${noun.usage}`,
            `about\t${noun.summary}`,
            ...noun.detail,
            ...actionLines(noun),
            `detail\t${cli} help ${noun.name} <action>\tone action in full`,
            spec.refusal
        ];
        return defineVerb({
            name: 'help',
            usage: '[noun] [action]',
            summary:
                'Lists every verb and noun; with a noun the signature of each of its actions, with a noun and an action or with a verb everything that one takes',
            detail: [
                'argument\t<noun>\toptional\tThe noun or verb to detail; without one every verb and noun is listed',
                'argument\t<action>\toptional\tOne action of that noun, in full',
                'prints\tverb\tname\targuments\tsummary\tone row per verb',
                'prints\tnoun\tname\tactions\tsummary\tone row per noun, its actions separated by |; a row that starts with neither is not one'
            ],
            positionals: z.array(z.string()).max(2, 'help takes a verb, or a noun and one of its actions, and nothing else'),
            flags: z.object({}),
            run: async ({ positionals: [name, actionWord] }) => {
                const entries = spec.entries();
                if (name === undefined) {
                    return [
                        ...summaryLines(entries),
                        ...spec.root(),
                        `detail\t${cli} help <noun>\tthe signature of every action of a noun`,
                        `detail\t${cli} help <noun> <action>\tone action in full`,
                        `detail\t${cli} help <verb>\tone verb in full`,
                        spec.refusal
                    ];
                }
                const entry = entries.find((candidate) => candidate.name === name);
                if (!entry) {
                    throw new VerbRefusal('unknown-verb', `${name} is not a verb or a noun`, [
                        `detail\t${cli} help\tevery verb and noun, with what each takes`,
                        ...summaryLines(entries)
                    ]);
                }
                if (entry.served !== 'noun') {
                    if (actionWord !== undefined) {
                        throw new VerbRefusal('bad-arguments', `${name} is a verb and has no actions; ${cli} help ${name} details it`, [
                            `detail\t${cli} help ${name}\tone verb in full`
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
    };

    const dryRunVerbNames = (): readonly string[] => dryRunVerbs;

    const dryRunLine = (): string =>
        `dry run\t--${DRY_RUN_FLAG}\t${dryRunVerbs.join(', ')}\tsame checks, nothing made; ${DRY_RUN_PREVIEW}; every other verb refuses the flag`;

    return { defineVerb, defineAction, defineNoun, defineHelp, dryRunVerbNames, dryRunLine };
};

/* How much came in, for a refusal that counts: zod hands its error function the input it rejected. */
export const lengthOf = (input: unknown): number => {
    if (typeof input === 'string' || Array.isArray(input)) {
        return input.length;
    }
    return 0;
};

/* A flag a verb cannot do without: the same sentence whether it was left out or left empty, since
   zod's own ("expected string, received undefined") names neither the flag nor what goes in it. */
export const requiredField = (needs: string): z.ZodString => z.string({ error: needs }).min(1, needs);

/*
 * What a refusal lists, or one line saying the set is empty. A refusal that promises the groups of a
 * canvas and then prints nothing reads as a daemon that lost them, where the truth is that there are
 * none, which is a different thing to do something about.
 */
export const orNote = (lines: string[], note: string): string[] => (lines.length === 0 ? [`note\t${note}`] : lines);
