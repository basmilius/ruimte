import { runCanvasVerb } from '../canvas/run-verb.ts';
import { REVISION_FLAG, VerbRefusal, type Action, type CanvasHost, type Noun, type Verb, type VerbEntry } from '../canvas/verb.ts';
import { VERBS } from '../canvas/verbs.ts';
import { listContext, readContext } from './context-tools.ts';
import { worded } from './descriptions.ts';
import { GUIDE_TOPICS, guideLines } from './guide.ts';
import { argvOf, checkKeys, DRY_RUN_KEY, fieldsOf, withFieldNames, type JsonField, type ToolField } from './fields.ts';
import type { AgentFiles } from './files.ts';
import { attachmentFlags, stageArtifact, type ArtifactUploads } from './uploads.ts';
import { prepareVisualPage } from './visual-images.ts';

/* Who sees a tool: every caller, only an AI chat, only while computer use is on, only in a project with a database connection. */
export type Audience = 'everyone' | 'chat' | 'computer' | 'database';

export interface ToolContext {
    caller: string;
    host: CanvasHost;
    /* The folders a file this caller names may come from, worked out on first use. */
    files(): Promise<AgentFiles>;
    uploads?: ArtifactUploads;
}

export interface ToolOutcome {
    lines: string[];
    /* Pictures the tool wrote, as paths on this machine, which go back as image content too. */
    images: string[];
}

export type InputSchema = {
    type: 'object';
    properties: Record<string, JsonField>;
    required?: string[];
};

export type ToolAnnotations = {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
};

export interface Tool {
    name: string;
    description: string;
    inputSchema: InputSchema;
    annotations: ToolAnnotations;
    audience: Audience;
    /* The registry names it runs, such as `node rename`, so a test sees that every action has a tool. */
    covers: readonly string[];
    run(input: Readonly<Record<string, unknown>>, context: ToolContext): Promise<ToolOutcome>;
}

/* The verbs without a noun, by the tool they became; one missing here keeps its own name. */
const VERB_TOOLS: Readonly<Record<string, string>> = {
    list: 'context_list',
    read: 'context_read',
    done: 'task_done',
    notify: 'notify',
    alert: 'alert',
    answer: 'agent_answer',
    agent: 'agent_start',
    team: 'agent_team',
    fork: 'agent_fork',
    flag: 'flag'
};

const NOUN_PREFIXES: Readonly<Record<string, string>> = { launches: 'launch' };

/* Gone: the schemas and descriptions of the tools are what it printed. */
const DROPPED_VERBS: ReadonlySet<string> = new Set(['help']);

interface Bundle {
    name: string;
    noun: string;
    actions: readonly string[];
    description: string;
    /* The field that picks the action; `action` unless the words read better as something else. */
    selector?: string;
}

/* Actions with the same fields and the same risk, one tool each. */
const BUNDLES: readonly Bundle[] = [
    {
        name: 'browser_history',
        noun: 'browser',
        actions: ['back', 'forward', 'reload', 'stop'],
        description: 'Moves a browser node back or forward, reloads it or stops its loading.'
    },
    { name: 'launch_control', noun: 'launches', actions: ['start', 'restart', 'stop'], description: 'Starts, restarts or stops an approved launch.' },
    { name: 'routine_toggle', noun: 'routine', actions: ['pause', 'resume'], description: 'Pauses or resumes a routine of this project.' },
    {
        name: 'language_lookup',
        noun: 'language',
        actions: ['hover', 'definition', 'references', 'supertypes', 'subtypes'],
        description: 'Asks the language server about the symbol at a line and column of a file.'
    },
    {
        name: 'language_file',
        noun: 'language',
        actions: ['diagnostics', 'symbols', 'sql'],
        description: "Asks the language server for a file's diagnostics, symbols or SQL connection."
    },
    {
        name: 'provider_info',
        noun: 'provider',
        actions: ['catalog', 'versions', 'limits'],
        description: "Reads the agent CLIs a person can install, their versions, or your plan's limits."
    },
    { name: 'device_input', noun: 'device', actions: ['tap', 'swipe', 'button', 'type'], description: 'Taps, swipes, presses a button or types on a device.' },
    { name: 'device_app', noun: 'device', actions: ['launch', 'terminate'], description: 'Launches or stops an app on a device.' },
    { name: 'plan_edit', noun: 'plan', actions: ['edit', 'move'], description: 'Changes an item of your plan, or moves it under or after another.' },
    {
        name: 'computer_act',
        noun: 'computer',
        actions: ['click', 'type', 'key', 'set-value', 'scroll', 'drag'],
        description: 'Clicks, types, presses keys, sets a value, scrolls or drags in an app.'
    },
    { name: 'ui_catalog', noun: 'ui', actions: [], description: 'Lists the UI components a visual may use, one group at a time.', selector: 'group' }
];

interface PatchPart {
    action: string;
    /* The tool's field and the action's own field it fills. */
    fields: Readonly<Record<string, string>>;
}

interface Patch {
    name: string;
    noun: string;
    description: string;
    parts: readonly PatchPart[];
}

/* Tools that take only the fields that change and run every action one of them belongs to. */
const PATCHES: readonly Patch[] = [
    {
        name: 'node_update',
        noun: 'node',
        description: 'Renames a node or changes its color; give only what changes.',
        parts: [
            { action: 'rename', fields: { title: 'title' } },
            { action: 'color', fields: { color: 'color' } }
        ]
    },
    {
        name: 'view_edit',
        noun: 'view',
        description: 'Renames a view, sets its icon or moves it; give only what changes.',
        parts: [
            { action: 'rename', fields: { name: 'name' } },
            { action: 'icon', fields: { icon: 'mark' } },
            { action: 'move', fields: { after: 'after', first: 'first' } }
        ]
    }
];

/* The flags whose value a verb reads `\n`, `\t` and `\\` in, which a tool doubles so its text arrives as sent. */
const ESCAPED_FLAGS: Readonly<Record<string, readonly string[]>> = {
    notify: ['text'],
    alert: ['text'],
    answer: ['answer'],
    agent: ['prompt'],
    done: ['result'],
    'node new': ['text'],
    'node edit': ['text'],
    'task new': ['prompt'],
    'plan set': ['note'],
    'plan note': ['text'],
    'plan add': ['description'],
    'plan edit': ['description'],
    'plan status': ['text'],
    'template new': ['body']
};

/* Flags a tool fills itself or that a field inline replaces: a file read on the CLI's side, the bytes it sent. */
const HIDDEN_FLAGS: Readonly<Record<string, readonly string[]>> = {
    agent: ['prompt-file'],
    done: ['result-file'],
    'task new': ['prompt-file'],
    'artifact publish': ['file', 'upload', 'files'],
    'chat attach': ['file', 'data'],
    'device media': ['path']
};

const READ_ONLY: ReadonlySet<string> = new Set([
    'context_list',
    'context_read',
    'node_list',
    'link_list',
    'view_list',
    'task_list',
    'browser_state',
    'browser_shot',
    'device_list',
    'device_state',
    'device_shot',
    'plan_read',
    'visual_list',
    'visual_preview',
    'artifact_list',
    'artifact_read',
    'ui_catalog',
    'worktree_list',
    'worktree_diff',
    'operation_get',
    'tool_list',
    'launch_list',
    'launch_read',
    'routine_list',
    'project_list',
    'project_ignored',
    'database_list',
    'database_tables',
    'database_describe',
    'database_query',
    'language_lookup',
    'language_file',
    'language_problems',
    'template_list',
    'provider_info',
    'computer_apps',
    'computer_state',
    'computer_read',
    'guide'
]);

const DESTRUCTIVE: ReadonlySet<string> = new Set([
    'node_delete',
    'link_delete',
    'view_delete',
    'plan_delete',
    'plan_remove',
    'visual_remove',
    'operation_cancel',
    'worktree_merge',
    'database_execute'
]);

const CHAT_TOOLS: ReadonlySet<string> = new Set(['chat_attach', 'secret_request', 'ui_catalog', 'project_propose']);

/* The tools that write a png and hand back its path. */
const IMAGE_TOOLS: ReadonlySet<string> = new Set(['browser_shot', 'device_shot', 'visual_preview', 'context_read']);

function audienceOf(name: string): Audience {
    if (name.startsWith('plan_') || name.startsWith('visual_') || CHAT_TOOLS.has(name)) {
        return 'chat';
    }

    if (name.startsWith('computer_')) {
        return 'computer';
    }

    return name.startsWith('database_') ? 'database' : 'everyone';
}

function annotationsOf(name: string): ToolAnnotations {
    if (READ_ONLY.has(name)) {
        return { readOnlyHint: true };
    }

    return { destructiveHint: DESTRUCTIVE.has(name) };
}

export function toolName(noun: string, word: string): string {
    return `${NOUN_PREFIXES[noun] ?? noun}_${word.replaceAll('-', '_')}`;
}

function verbTool(name: string): string {
    return VERB_TOOLS[name] ?? name.replaceAll('-', '_');
}

/* The paths a verb printed for a png it wrote: every tab-separated field that is an absolute path to one. */
function imagePaths(lines: readonly string[]): string[] {
    return lines.flatMap((line) => line.split(/[\t\n]/)).filter((part) => part.startsWith('/') && part.endsWith('.png'));
}

/*
 * The tool each registry name and noun went to, so a sentence that names a `ruimte-context` command
 * names the tool instead. Built before the descriptions, which are rewritten with it.
 */
function toolNames(entries: readonly VerbEntry[]): Map<string, string> {
    const names = new Map<string, string>();
    const bundled = new Map<string, string>();

    for (const bundle of BUNDLES) {
        for (const action of bundle.actions) {
            bundled.set(`${bundle.noun} ${action}`, bundle.name);
        }
    }

    for (const patch of PATCHES) {
        for (const part of patch.parts) {
            bundled.set(`${patch.noun} ${part.action}`, patch.name);
        }
    }

    for (const entry of entries) {
        if (entry.served !== 'noun') {
            names.set(entry.name, verbTool(entry.name));

            continue;
        }

        for (const action of entry.actions) {
            names.set(action.name, bundled.get(action.name) ?? (entry.name === 'ui' ? 'ui_catalog' : toolName(entry.name, action.word)));
        }
    }

    return names;
}

/* A help text with every `ruimte-context <verb> [action]` it names written as the tool that does it. */
export function withToolNames(text: string, names: ReadonlyMap<string, string>): string {
    const tools = new Set(names.values());

    // An action id such as `device.list`, from the catalog the verbs read their descriptions from; one
    // followed by `:` is part of an operation id such as `agent.start:<id>`, which stays as the daemon wrote it.
    const actions = text.replace(/(?<![\w.])([a-z]+)\.([a-z]+)\b(?![:.\w-])/g, (whole, noun: string, word: string) =>
        tools.has(`${noun}_${word}`) ? `${noun}_${word}` : whole
    );

    return actions.replace(/ruimte-context(?: ([a-z][\w-]*)(?: ([a-z][\w-]*))?)?/g, (whole, first: string | undefined, second: string | undefined) => {
        if (first === undefined) {
            return 'the Ruimte tools';
        }

        const pair = second === undefined ? undefined : names.get(`${first} ${second}`);

        if (pair !== undefined) {
            return pair;
        }

        const single = names.get(first);

        if (single === undefined) {
            return whole;
        }

        return second === undefined ? single : `${single} ${second}`;
    });
}

/* The first sentence of a summary, which is what a tool says of itself. */
function firstSentence(text: string): string {
    const end = text.search(/[.;](\s|$)/);

    return end === -1 ? `${text}.` : `${text.slice(0, end)}.`;
}

function schemaOf(fields: readonly ToolField[], extra: readonly ToolField[] = []): InputSchema {
    const all = [...fields, ...extra];
    const required = all.filter((field) => field.required).map((field) => field.key);

    return {
        type: 'object',
        properties: Object.fromEntries(all.map((field) => [field.key, field.schema])),
        ...(required.length > 0 ? { required } : {})
    };
}

function renamed(fields: readonly ToolField[], names: ReadonlyMap<string, string>): ToolField[] {
    return fields.map((field) =>
        field.schema.description === undefined ? field : { ...field, schema: { ...field.schema, description: withToolNames(field.schema.description, names) } }
    );
}

interface ActionHooks {
    /* Fields the tool takes besides the verb's own, which `prepare` turns into words. */
    extra?: readonly ToolField[];
    prepare?(input: Readonly<Record<string, unknown>>, argv: string[], context: ToolContext): Promise<{ argv: string[]; lines: string[] }>;
}

function stringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(String);
    }

    return value === undefined || value === null ? [] : [String(value)];
}

const visualPage =
    (action: 'show' | 'preview') =>
    async (_input: Readonly<Record<string, unknown>>, argv: string[], context: ToolContext): Promise<{ argv: string[]; lines: string[] }> => {
        const prepared = await prepareVisualPage(action, argv, { files: (await context.files()).images() });

        if ('refusal' in prepared) {
            throw new VerbRefusal(prepared.refusal.code, prepared.refusal.message, prepared.refusal.lines);
        }

        return { argv: prepared.argv, lines: prepared.lines };
    };

const PATHS_FIELD: ToolField = {
    key: 'paths',
    kind: 'variadic',
    flag: 'path',
    required: true,
    schema: { type: 'array', items: { type: 'string' } }
};

const HOOKS: Readonly<Record<string, ActionHooks>> = {
    // The first path goes in --path and the others follow as arguments, which is how the verb takes several.
    'device media': {
        extra: [PATHS_FIELD],
        async prepare(input, argv) {
            const [first, ...rest] = stringList(input.paths);

            if (first === undefined) {
                throw new VerbRefusal('bad-arguments', 'device_media needs paths, at least one file');
            }

            return { argv: [...argv, ...rest, `--path=${first}`], lines: [] };
        }
    },
    'visual show': { prepare: visualPage('show') },
    'visual preview': { prepare: visualPage('preview') },
    'artifact publish': {
        extra: [
            {
                key: 'paths',
                kind: 'variadic',
                flag: 'file',
                required: true,
                schema: { type: 'array', items: { type: 'string' } }
            }
        ],
        async prepare(input, argv, context) {
            if (!context.uploads) {
                throw new VerbRefusal('unavailable', 'This machine keeps no Output');
            }

            const requestId = input.request_id === undefined ? undefined : String(input.request_id);
            const staged = await stageArtifact(context.uploads, await context.files(), context.caller, stringList(input.paths), requestId);

            return { argv: [...argv.filter((word) => !word.startsWith('--request-id=')), ...staged], lines: [] };
        }
    },
    'chat attach': {
        extra: [
            {
                key: 'path',
                kind: 'flag',
                flag: 'file',
                required: true,
                schema: { type: 'string' }
            }
        ],
        async prepare(input, argv, context) {
            if (typeof input.path !== 'string' || input.path === '') {
                throw new VerbRefusal('bad-arguments', 'chat_attach needs path, an image or model file of your own');
            }

            const name = typeof input.name === 'string' && input.name !== '' ? input.name : undefined;
            const flags = await attachmentFlags(await context.files(), input.path, name);

            return { argv: [...argv.filter((word) => !word.startsWith('--name=')), ...flags], lines: [] };
        }
    }
};

/* Runs the words for one action and answers what it printed, with any png it wrote. */
async function runWords(name: string, target: Verb | Noun, words: string[], context: ToolContext, extra: readonly string[] = []): Promise<ToolOutcome> {
    const lines = [...(await runCanvasVerb(target, words, context.caller, context.host)), ...extra];

    return { lines, images: IMAGE_TOOLS.has(name) ? imagePaths(lines) : [] };
}

function actionTool(name: string, target: Verb | Noun, entry: Verb | Action, names: ReadonlyMap<string, string>): Tool {
    const hooks = HOOKS[entry.name] ?? {};
    const fields = renamed(fieldsOf(entry, new Set(HIDDEN_FLAGS[entry.name] ?? [])), names);
    const escaped = new Set(ESCAPED_FLAGS[entry.name] ?? []);
    const extra = hooks.extra ?? [];

    return {
        name,
        description: withFieldNames(withToolNames(firstSentence(entry.summary), names)),
        inputSchema: schemaOf(fields, extra),
        annotations: annotationsOf(name),
        audience: audienceOf(name),
        covers: [entry.name],
        async run(input, context) {
            checkKeys(name, [...fields, ...extra], input);
            const argv = argvOf(fields, input, escaped);
            const prepared = hooks.prepare === undefined ? { argv, lines: [] } : await hooks.prepare(input, argv, context);
            const words = target.served === 'noun' && 'word' in entry ? [entry.word, ...prepared.argv] : prepared.argv;

            return runWords(name, target, words, context, prepared.lines);
        }
    };
}

/* The fields of several actions as one: the first description of each, required only where every action needs it. */
function unionFields(sets: readonly (readonly ToolField[])[]): ToolField[] {
    const merged = new Map<string, ToolField>();

    for (const fields of sets) {
        for (const field of fields) {
            const known = merged.get(field.key);
            merged.set(field.key, known === undefined ? field : { ...known, schema: known.schema.description === undefined ? field.schema : known.schema });
        }
    }

    return [...merged.values()].map((field) => ({
        ...field,
        required: sets.every((fields) => fields.some((candidate) => candidate.key === field.key && candidate.required))
    }));
}

function bundleTool(bundle: Bundle, noun: Noun, names: ReadonlyMap<string, string>): Tool | null {
    const words = bundle.actions.length === 0 ? noun.actions.map((action) => action.word) : bundle.actions;
    const actions = words.map((word) => noun.actions.find((action) => action.word === word)).filter((action): action is Action => action !== undefined);

    if (actions.length === 0) {
        return null;
    }

    const selector = bundle.selector ?? 'action';
    const fieldSets = actions.map((action) => renamed(fieldsOf(action), names));
    const fields = unionFields(fieldSets);
    const choice: ToolField = {
        key: selector,
        kind: 'flag',
        flag: selector,
        required: true,
        schema: { type: 'string', enum: actions.map((action) => action.word) }
    };
    const readOnly = READ_ONLY.has(bundle.name);

    return {
        name: bundle.name,
        description: bundle.description,
        inputSchema: schemaOf([choice, ...fields]),
        annotations: readOnly ? { readOnlyHint: true } : { destructiveHint: DESTRUCTIVE.has(bundle.name) },
        audience: audienceOf(bundle.name),
        covers: actions.map((action) => action.name),
        async run(input, context) {
            const index = actions.findIndex((action) => action.word === input[selector]);

            if (index === -1) {
                throw new VerbRefusal('bad-arguments', `${bundle.name} needs ${selector}, one of ${actions.map((action) => action.word).join(', ')}`);
            }

            const action = actions[index]!;
            const own = fieldSets[index]!;
            const { [selector]: _picked, ...rest } = input;
            checkKeys(`${bundle.name} ${action.word}`, own, rest);

            return runWords(bundle.name, noun, [action.word, ...argvOf(own, rest, new Set(ESCAPED_FLAGS[action.name] ?? []))], context);
        }
    };
}

const NOT_IN_PATCHES: ReadonlySet<string> = new Set(['json', DRY_RUN_KEY]);

function patchTool(patch: Patch, noun: Noun, names: ReadonlyMap<string, string>): Tool | null {
    const parts = patch.parts.flatMap((part) => {
        const action = noun.actions.find((candidate) => candidate.word === part.action);

        return action === undefined
            ? []
            : [{ action, triggers: part.fields, fields: renamed(fieldsOf(action), names).filter((field) => !NOT_IN_PATCHES.has(field.key)) }];
    });

    if (parts.length === 0) {
        return null;
    }

    const targets = new Set(parts.flatMap((part) => Object.values(part.triggers)));
    const shared = parts[0]!.fields
        .filter((field) => !targets.has(field.key) && parts.every((part) => part.fields.some((candidate) => candidate.key === field.key)))
        .map((field) => ({ ...field, required: parts.some((part) => part.fields.some((candidate) => candidate.key === field.key && candidate.required)) }));
    const triggerFields = parts.flatMap((part) =>
        Object.entries(part.triggers).flatMap(([key, own]) => {
            const field = part.fields.find((candidate) => candidate.key === own);

            return field === undefined ? [] : [{ ...field, key, required: false }];
        })
    );
    const all = [...shared, ...triggerFields];

    /* What one part's own fields take from the tool's input: a trigger by the tool's name for it, the rest as they are. */
    const inputOf = (part: (typeof parts)[number], input: Readonly<Record<string, unknown>>, first: boolean): Record<string, unknown> => {
        const keys = new Map(Object.entries(part.triggers).map(([key, own]) => [own, key]));

        return Object.fromEntries(
            part.fields
                // The revision holds the first write; each later one follows from it.
                .filter((field) => first || field.key !== REVISION_FLAG)
                .map((field) => [field.key, input[keys.get(field.key) ?? field.key]])
        );
    };

    return {
        name: patch.name,
        description: patch.description,
        inputSchema: schemaOf(all),
        annotations: { destructiveHint: false },
        audience: audienceOf(patch.name),
        covers: parts.map((part) => part.action.name),
        async run(input, context) {
            checkKeys(patch.name, all, input);
            const chosen = parts.filter((part) => Object.keys(part.triggers).some((key) => input[key] !== undefined && input[key] !== null));

            if (chosen.length === 0) {
                throw new VerbRefusal('nothing-to-change', `${patch.name} needs one of ${triggerFields.map((field) => field.key).join(', ')}`);
            }

            const lines: string[] = [];

            for (const [index, part] of chosen.entries()) {
                const words = [part.action.word, ...argvOf(part.fields, inputOf(part, input, index === 0))];
                lines.push(...(await runWords(patch.name, noun, words, context)).lines);
            }

            return { lines, images: [] };
        }
    };
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

const READ_FIELDS: readonly ToolField[] = [
    {
        key: 'id',
        kind: 'positional',
        flag: 'id',
        required: true,
        schema: { type: 'string' }
    },
    { key: 'tail', kind: 'flag', flag: 'tail', required: false, schema: { type: 'integer' } },
    { key: 'view', kind: 'flag', flag: 'view', required: false, schema: { type: 'string' } },
    { key: 'project', kind: 'flag', flag: 'project', required: false, schema: { type: 'string' } },
    { key: 'subagent', kind: 'flag', flag: 'subagent', required: false, schema: { type: 'string' } },
    { key: 'form', kind: 'flag', flag: 'form', required: false, schema: { type: 'string', enum: ['elements', 'image'] } }
];

function contextTool(entry: VerbEntry, names: ReadonlyMap<string, string>): Tool | null {
    if (entry.name === 'list') {
        return {
            name: 'context_list',
            description: withFieldNames(withToolNames(firstSentence(entry.summary), names)),
            inputSchema: schemaOf([]),
            annotations: annotationsOf('context_list'),
            audience: 'everyone',
            covers: [entry.name],
            async run(input, context) {
                checkKeys('context_list', [], input);

                return { lines: await listContext(context.host, context.caller), images: [] };
            }
        };
    }

    if (entry.name !== 'read') {
        return null;
    }

    return {
        name: 'context_read',
        description: withFieldNames(withToolNames(firstSentence(entry.summary), names)),
        inputSchema: schemaOf(READ_FIELDS),
        annotations: annotationsOf('context_read'),
        audience: 'everyone',
        covers: [entry.name],
        async run(input, context) {
            checkKeys('context_read', READ_FIELDS, input);
            const id = text(input.id);
            const tail = input.tail === undefined || input.tail === null ? null : Number(input.tail);
            const form = input.form === 'elements' || input.form === 'image' ? input.form : null;

            if (id === null) {
                throw new VerbRefusal('bad-arguments', 'context_read needs id, a source from context_list');
            }

            if (tail !== null && (!Number.isInteger(tail) || tail < 1)) {
                throw new VerbRefusal('bad-arguments', 'tail is a positive whole number of lines');
            }

            if (input.form !== undefined && input.form !== null && form === null) {
                throw new VerbRefusal('bad-arguments', 'form is elements or image');
            }

            const lines = await readContext(context.host, context.caller, {
                id,
                tail,
                subagent: text(input.subagent),
                view: text(input.view),
                project: text(input.project),
                form
            });

            return { lines, images: form === 'image' ? imagePaths(lines) : [] };
        }
    };
}

const TOPIC_FIELD: ToolField = { key: 'topic', kind: 'flag', flag: 'topic', required: true, schema: { type: 'string', enum: Object.keys(GUIDE_TOPICS) } };

/* The formats of the text inputs, read on demand so no schema has to carry them. */
function guideTool(entries: readonly VerbEntry[], names: ReadonlyMap<string, string>): Tool {
    return {
        name: 'guide',
        description: 'Prints the format of an input whose field names a topic.',
        inputSchema: schemaOf([TOPIC_FIELD]),
        annotations: annotationsOf('guide'),
        audience: 'everyone',
        covers: [],
        async run(input) {
            checkKeys('guide', [TOPIC_FIELD], input);
            const lines = typeof input.topic === 'string' ? guideLines(input.topic, entries, (line) => withToolNames(line, names)) : [];

            if (lines.length === 0) {
                throw new VerbRefusal('bad-arguments', `guide needs topic, one of ${Object.keys(GUIDE_TOPICS).join(', ')}`);
            }

            return { lines, images: [] };
        }
    };
}

/*
 * One tool per action of the registry, bundled and named as the design of the MCP server has them.
 * Throws when two tools would share a name, which a test holds against the registry as it is.
 */
export function buildCatalog(entries: readonly VerbEntry[] = VERBS): Tool[] {
    const names = toolNames(entries);
    const tools: Tool[] = [];

    for (const entry of entries) {
        if (entry.served === 'context') {
            const tool = contextTool(entry, names);

            if (tool !== null) {
                tools.push(tool);
            }

            continue;
        }

        if (entry.served === 'verb') {
            if (!DROPPED_VERBS.has(entry.name)) {
                tools.push(actionTool(verbTool(entry.name), entry, entry, names));
            }

            continue;
        }

        const made = new Set<string>();

        for (const action of entry.actions) {
            const name = names.get(action.name)!;

            if (made.has(name)) {
                continue;
            }

            made.add(name);
            const bundle = BUNDLES.find((candidate) => candidate.name === name);
            const patch = PATCHES.find((candidate) => candidate.name === name);
            const tool = bundle ? bundleTool(bundle, entry, names) : patch ? patchTool(patch, entry, names) : actionTool(name, entry, action, names);

            if (tool !== null) {
                tools.push(tool);
            }
        }
    }

    tools.push(guideTool(entries, names));

    const seen = new Set<string>();

    for (const tool of tools) {
        if (seen.has(tool.name)) {
            throw new Error(`Two tools are named ${tool.name}`);
        }

        seen.add(tool.name);
    }

    return tools.map(worded);
}

let built: readonly Tool[] | null = null;

/* The catalog of the registry this daemon runs, built once. */
export function catalog(): readonly Tool[] {
    built ??= buildCatalog();

    return built;
}

/* What every refusal line and description rewrites a `ruimte-context` command with. */
export function catalogNames(): ReadonlyMap<string, string> {
    return toolNames(VERBS);
}
