import { z } from 'zod';
import { ACTION_DEFINITIONS, ACTION_DOMAINS, type ActionDomain, type ActionName } from './catalog.ts';

type JsonSchema = Record<string, unknown>;

export interface VoiceToolDefinition {
    type: 'function';
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, JsonSchema>;
        required: string[];
        additionalProperties: false;
    };
    strict: true;
}

export const VOICE_CONTROL_TOOL = 'control_action';

const DOMAIN_TOOLS: Record<ActionDomain, { name: string; description: string }> = {
    workspace: {
        name: 'inspect_workspace',
        description: 'Read the current project, its views, the active canvas and its selection, or resolve spoken names to the ids every other tool takes.'
    },
    views: { name: 'manage_views', description: 'Focus, create, rename, duplicate or delete views, or bring a view onto the canvas.' },
    canvas: {
        name: 'manage_canvas',
        description: 'Create, focus, rename, select, group, move or delete nodes on the active canvas, and control its camera, history and locks.'
    },
    layout: { name: 'manage_layout', description: 'Save, apply or delete layouts of the active canvas, and split, close or move between the cells on screen.' },
    communicate: { name: 'communicate', description: 'Send a direct prompt to, read or clear an AI Chat, or read or clear a terminal.' },
    sessions: {
        name: 'run_sessions',
        description:
            'Run the AI Chats and terminals of this project: read what a chat waits on, stop a turn, a sub-agent, a background task or a terminal, handle queued messages, answer a question in the user’s words, compact, change the model, fork, summarize a fork, read what a turn changed or what a sub-agent wrote, and resume a terminal agent. Approvals are the user’s to answer in the app.'
    },
    plans: { name: 'manage_plans', description: 'Read the plans of an AI Chat, set the state of its steps and write a note on a step.' },
    agents: { name: 'inspect_agents', description: 'Read the status of the agents in this project and the tool calls of an AI Chat.' },
    projects: { name: 'manage_projects', description: 'List the projects open in the project navigation or switch to one of them.' },
    developer: {
        name: 'manage_git',
        description:
            'Read and change the git repositories and worktrees of this project: status, diffs, history, branches, staging, commits, fetch, pull, push, merges, stashes, pull requests and worktrees. Repositories are named by the label git.status gives them.'
    }
};

/* Fields only Voice's adapter reads; the action never sees them. */
const VOICE_FIELDS: Partial<Record<ActionDomain, Record<string, JsonSchema>>> = {
    communicate: {
        notify_on_completion: {
            type: 'boolean',
            description:
                'With chat.send: true when the user asks Voice to wait for the answer or report the result after the AI Chat finishes. This schedules an automatic spoken notification. False for every other action.'
        }
    }
};

const CONTROL_TOOL: VoiceToolDefinition = {
    type: 'function',
    name: VOICE_CONTROL_TOOL,
    description:
        'Confirm or cancel an action that returned a confirmation request, after the user answers its question. Never confirm during the same turn that first requested the action.',
    parameters: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['confirm', 'cancel'] },
            confirmation_token: { type: 'string' }
        },
        required: ['action', 'confirmation_token'],
        additionalProperties: false
    },
    strict: true
};

/* Strict function schemas refuse keywords outside their subset; the registry checks these again on every call. */
const UNSUPPORTED_KEYWORDS = new Set(['$schema', 'minLength', 'maxLength', 'actors']);

/* A field, or a member of a union, that the catalog keeps for other actors is none of Voice's business. */
const forVoice = (schema: unknown): boolean => {
    const actors = (schema as JsonSchema).actors;
    return !Array.isArray(actors) || actors.includes('voice');
};

const voiceMembers = (schema: JsonSchema): JsonSchema => {
    if (!Array.isArray(schema.anyOf)) {
        return schema;
    }
    const members = schema.anyOf.filter(forVoice) as JsonSchema[];
    if (members.length === 1) {
        const { anyOf: _anyOf, ...rest } = schema;
        return { ...rest, ...members[0] };
    }
    return { ...schema, anyOf: members };
};

const supported = (schema: unknown): unknown => {
    if (Array.isArray(schema)) {
        return schema.map(supported);
    }
    if (typeof schema !== 'object' || schema === null) {
        return schema;
    }
    return Object.fromEntries(
        Object.entries(schema)
            .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
            .map(([key, value]) => [key, supported(value)])
    );
};

const isNull = (schema: unknown): boolean => typeof schema === 'object' && schema !== null && (schema as JsonSchema).type === 'null';

const withoutNull = (schema: JsonSchema): { schema: JsonSchema; nullable: boolean } => {
    if (Array.isArray(schema.anyOf) && schema.anyOf.some(isNull)) {
        const rest = schema.anyOf.filter((member) => !isNull(member)) as JsonSchema[];
        if (rest.length === 1) {
            return { schema: { ...rest[0], ...(schema.description === undefined ? {} : { description: schema.description }) }, nullable: true };
        }
    }
    if (Array.isArray(schema.type) && schema.type.includes('null')) {
        const types = schema.type.filter((type) => type !== 'null');
        return {
            schema: {
                ...schema,
                type: types.length === 1 ? types[0] : types,
                ...(Array.isArray(schema.enum) ? { enum: schema.enum.filter((value) => value !== null) } : {})
            },
            nullable: true
        };
    }
    return { schema, nullable: false };
};

const nullable = (schema: JsonSchema): JsonSchema => {
    if (typeof schema.type === 'string' && schema.type !== 'object') {
        return { ...schema, type: [schema.type, 'null'], ...(Array.isArray(schema.enum) ? { enum: [...schema.enum, null] } : {}) };
    }
    const { description, ...rest } = schema;
    return { anyOf: [rest, { type: 'null' }], ...(description === undefined ? {} : { description }) };
};

/* Two actions of one tool may share a field name, so they have to agree on what it holds; enums join. */
const joined = (field: string, left: JsonSchema, right: JsonSchema): JsonSchema => {
    const { description: leftDescription, ...leftShape } = left;
    const { description: rightDescription, ...rightShape } = right;
    const description = leftDescription ?? rightDescription;
    if (Array.isArray(leftShape.enum) && Array.isArray(rightShape.enum) && leftShape.type === rightShape.type) {
        return { ...leftShape, enum: [...new Set([...leftShape.enum, ...rightShape.enum])], ...(description === undefined ? {} : { description }) };
    }
    if (JSON.stringify(leftShape) !== JSON.stringify(rightShape)) {
        throw new Error(`The field “${field}” has two different shapes in one Voice tool.`);
    }
    return { ...leftShape, ...(description === undefined ? {} : { description }) };
};

const inputFields = (name: ActionName): [string, { schema: JsonSchema; nullable: boolean }][] => {
    const schema = z.toJSONSchema(ACTION_DEFINITIONS[name].input) as { properties?: Record<string, JsonSchema> };
    return Object.entries(schema.properties ?? {})
        .filter(([, value]) => forVoice(value))
        .map(([field, value]) => [field, withoutNull(supported(voiceMembers(value)) as JsonSchema)]);
};

const signature = (name: ActionName): string =>
    `${name}(${inputFields(name)
        .map(([field, entry]) => `${field}${entry.nullable ? '?' : ''}`)
        .join(', ')})`;

const toolOf = (domain: ActionDomain, actions: readonly ActionName[]): VoiceToolDefinition => {
    const fields = new Map<string, { schema: JsonSchema; nullable: boolean; actions: number }>();
    for (const action of actions) {
        for (const [field, entry] of inputFields(action)) {
            const known = fields.get(field);
            fields.set(
                field,
                known
                    ? { schema: joined(field, known.schema, entry.schema), nullable: known.nullable || entry.nullable, actions: known.actions + 1 }
                    : { ...entry, actions: 1 }
            );
        }
    }
    const properties: Record<string, JsonSchema> = {
        action: { type: 'string', enum: [...actions] },
        ...Object.fromEntries(
            [...fields].map(([field, entry]) => [field, entry.nullable || entry.actions < actions.length ? nullable(entry.schema) : entry.schema])
        ),
        ...VOICE_FIELDS[domain]
    };
    const { name, description } = DOMAIN_TOOLS[domain];
    return {
        type: 'function',
        name,
        description: [
            `${description} Actions take ids, never names. Pass null for every field the chosen action does not list; a field marked ? may be null.`,
            ...actions.map((action) => `- ${signature(action)}: ${ACTION_DEFINITIONS[action].description}`)
        ].join('\n'),
        parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
        strict: true
    };
};

const voiceActionsOf = (domain: ActionDomain): ActionName[] =>
    (Object.keys(ACTION_DEFINITIONS) as ActionName[]).filter((name) => {
        const definition = ACTION_DEFINITIONS[name];
        return definition.domain === domain && definition.actors.includes('voice');
    });

const DOMAIN_ACTIONS = ACTION_DOMAINS.map((domain) => ({ domain, actions: voiceActionsOf(domain) })).filter(({ actions }) => actions.length > 0);

/* The actions each tool reaches. Discovery is convenience: the registry still checks the actor and the input on every call. */
export const VOICE_TOOL_ACTIONS: ReadonlyMap<string, readonly ActionName[]> = new Map(
    DOMAIN_ACTIONS.map(({ domain, actions }) => [DOMAIN_TOOLS[domain].name, actions])
);

export const VOICE_TOOL_DEFINITIONS: readonly VoiceToolDefinition[] = [...DOMAIN_ACTIONS.map(({ domain, actions }) => toolOf(domain, actions)), CONTROL_TOOL];
