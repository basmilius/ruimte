import { MAX_PROMPT_LENGTH, MAX_OPENED_PER_CALLER } from '@ruimte/actions';
import { z } from 'zod';
import { defineStandaloneActionVerb, runAction } from './action-verb.ts';
import { AGENT_KINDS, chatKinds } from './agents.ts';
import { DEPTH_LIMIT_LINES, MAX_TEAM_DEPTH } from './depth.ts';
import { readsFlag, readsLines } from './link-verb.ts';
import { MODE_LINES, modeFlag } from './mode.ts';
import { modelFlag, modelLines } from './model.ts';
import { MAX_CANVAS_NODES, idList } from './nodes.ts';
import { TEAM_COLUMNS } from './placement.ts';
import { TASK_LINES, nextLine } from './task-verbs.ts';
import { MAX_TASK_PROMPT_LENGTH } from './tasks.ts';
import { DRY_RUN_PREVIEW, MAX_TITLE_LENGTH, TITLE_LINE, VerbRefusal, field, lengthOf, titleField } from './verb.ts';
import { WORKTREE_LINES } from './worktree.ts';

/* As many as one caller may have open at once, so a single team can fill that allowance and no more. */
export const MAX_ROLES = MAX_OPENED_PER_CALLER;

/* Every field says its own sentence, so a role that is missing one reads the same as a role that
   filled it with the wrong thing; zod's default would name a type where the agent needs the field. */
const RoleSchema = z.strictObject({
    title: titleField('title', 'title needs a name for the node'),
    prompt: z
        .string({ error: 'prompt says what this agent starts working on' })
        .trim()
        .min(1, 'prompt says what this agent starts working on')
        .max(MAX_PROMPT_LENGTH, {
            error: (issue) => `prompt is ${lengthOf(issue.input)} characters and at most ${MAX_PROMPT_LENGTH} fit on the line a CLI is started with`
        }),
    provider: z.enum(AGENT_KINDS, { error: `provider needs a CLI: ${AGENT_KINDS.join(', ')}` }),
    model: modelFlag,
    terminal: z.boolean({ error: 'terminal is true or false' }).optional()
});

type Role = z.infer<typeof RoleSchema>;

const RolesSchema = z
    .array(RoleSchema, { error: '--roles is a JSON array of roles' })
    .min(1, `--roles has no roles in it; a team is between 1 and ${MAX_ROLES} of them`)
    .max(MAX_ROLES, { error: (issue) => `--roles has ${lengthOf(issue.input)} roles and a team takes at most ${MAX_ROLES}` });

export const ROLES_SHAPE = '[{"title": "Lexer", "prompt": "Fix the tokenizer", "provider": "claude"}]';

/* The shape, said the same way in help and under a refusal, so a bad call is one read away from a good one. */
const ROLES_LINES: readonly string[] = [
    `roles\tshape\t${ROLES_SHAPE}`,
    `roles\ttitle\trequired\tThe title of the node, at most ${MAX_TITLE_LENGTH} characters; the session never renames over it`,
    `roles\tprompt\trequired\tWhat that agent starts working on, at most ${MAX_PROMPT_LENGTH} characters`,
    `roles\tprovider\trequired\t${AGENT_KINDS.join(', ')}`,
    `roles\tterminal\toptional\ttrue opens a terminal node instead of a chat node; a CLI without a chat backend is a terminal anyway (only ${chatKinds().join(', ')} have one)`,
    "roles\tmodel\toptional\tThe model id for a chat role, with that model's default options; omitted uses the composer preference. Refused for terminals and unknown models",
    ...chatKinds().flatMap(modelLines),
    `roles\tcount\tbetween 1 and ${MAX_ROLES}`
];

const TEAM_DETAIL: readonly string[] = [
    ...ROLES_LINES,
    'json\tA prompt is a JSON string, so a line break in it is \\n of JSON itself and nothing is escaped twice',
    `quoting\tThe JSON goes in single quotes, so an apostrophe in a prompt ends the quote early: write it as '\\'' or as \\u0027 inside the JSON string`,
    `example\truimte-context team --label "Parser work" --roles '[{"title":"Lexer","prompt":"Fix the tokenizer in src/lex.ts","provider":"claude"},{"title":"Reviewer","prompt":"Read the Lexer node and review its work","provider":"codex"},{"title":"Shell","prompt":"Run the lexer tests","provider":"claude","terminal":true}]'`,
    'prints\tid\tkind\ttitle\tview\tcli\tedge\ttask\tthe group first, its label in the title column and a dash for the CLI and the edge, then one line per role in the order of --roles, with the id of its task last under --task; the title is what tells two rows of one CLI apart',
    'prints\treads\tid\tfrom\tto\tone line per --reads node per role, under the roles: the line drawn from that node into that agent',
    'prints\tnext\tthe last line under --task, saying what to do while the tasks run',
    'edges\tOne edge per role, from you into that agent, so each of them can read you with ruimte-context read; a line only joins two nodes of one canvas',
    'edges\tOne way only: you do not read them through it, and the roles do not read each other',
    "edges\tWithout --task, ruimte-context link new --to <the role's id> draws the line back, which is how you read what a role has done; its id is the first field of that role's row",
    'edges\tWith --task no line back is needed, since the results of the roles arrive as your next message once they all settled',
    'edges\truimte-context link list lists what is drawn on the canvas now',
    ...readsLines('every role'),
    'where\tThe group lands on the first free spot right of you, or right of everything when you are none of its nodes',
    'where\tFrom any other view name a canvas with --view; the edge column of every row then shows -',
    `group\tThe agents stand in rows of at most ${TEAM_COLUMNS} inside the frame, and the frame is sized to hold them`,
    'refusal\tA role that is wrong is named by its place in the array, counting from 0',
    'paths\t--cwd is resolved against the project folder and has to stay inside it or a worktree of its repository',
    'prompt\tA terminal role gets its prompt on the line its CLI is started with, a chat role as the first message of its thread; it is delivered once and never written into project.json',
    `limit\tA canvas holds at most ${MAX_CANVAS_NODES} nodes, the group among them`,
    TITLE_LINE,
    ...TASK_LINES,
    ...DEPTH_LIMIT_LINES,
    ...MODE_LINES,
    ...WORKTREE_LINES,
    `depth\tA role lands at depth ${MAX_TEAM_DEPTH}: it may open a single agent of its own with agent, and a team of its own is refused`,
    'operation\tStarting is not succeeding: ruimte-context operation get team.start:<id>,<id> with the ids of the roles in the order they were printed says how the team goes, role by role',
    'note\tThe machine starts every agent right away, whether or not anyone has its canvas open; a client that shows one later joins what runs'
];

/*
 * Which role is wrong and why. zod says `[2].prompt`, and an agent that wrote the JSON needs the
 * index back to find the object it typed, so the path is spelled out in front of the sentence.
 */
const rolesMessage = (error: z.ZodError): string => {
    const issue = error.issues[0];
    if (!issue) {
        return '--roles is not a list of roles';
    }
    const [index, key] = issue.path;
    if (typeof index !== 'number') {
        return issue.message;
    }
    return `role ${index}${typeof key === 'string' ? ` (${key})` : ''}: ${issue.message}`;
};

const parseRoles = (raw: string): Role[] => {
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch (e) {
        throw new VerbRefusal('bad-roles-json', `--roles is not JSON: ${e instanceof Error ? e.message : 'it could not be read'}`, [...ROLES_LINES]);
    }
    const parsed = RolesSchema.safeParse(json);
    if (!parsed.success) {
        throw new VerbRefusal('bad-roles', rolesMessage(parsed.error), [...ROLES_LINES]);
    }
    return parsed.data;
};

export const teamVerb = defineStandaloneActionVerb({
    name: 'team',
    action: 'team.start',
    usage: `--label L --roles '${ROLES_SHAPE}' [--view V] [--cwd P] [--reads A,B] [--task] [--mode M] [--worktree] [--dry-run]`,
    params: [
        { syntax: '--label L', need: 'required', field: 'label', text: `The name of the group the agents land in, at most ${MAX_TITLE_LENGTH} characters` },
        { syntax: '--roles J', need: 'required', field: 'roles', text: `The roles as JSON, ${ROLES_SHAPE}` },
        { syntax: '--cwd P', need: 'optional', field: 'cwd', more: 'a directory per role is --worktree' },
        {
            syntax: '--reads A,B',
            need: 'optional',
            field: 'reads',
            text: 'Nodes every role can read from its first turn, by id, separated by commas: a line is drawn from each of them into each role'
        },
        {
            syntax: '--view V',
            need: 'optional',
            field: 'viewId',
            more: 'ruimte-context view list lists them. Without it the view you are in, when that is a canvas'
        },
        { syntax: '--mode M', need: 'optional', field: 'mode' },
        { syntax: '--worktree', need: 'no value', field: 'worktree', more: 'not together with --cwd' },
        { syntax: '--task', need: 'no value', field: 'task', more: `each prompt at most ${MAX_TASK_PROMPT_LENGTH} characters` },
        {
            syntax: '--dry-run',
            need: 'no value',
            text: `Checks everything and makes nothing; the first field of every line is dry-run and the last names the edge it would draw, as <from> -> <the role's title>; every role is checked before any is made, and ${DRY_RUN_PREVIEW}`
        }
    ],
    detail: TEAM_DETAIL,
    dryRun: true,
    switches: ['task', 'worktree'],
    positionals: z.tuple([], { error: 'team takes no arguments, only flags; the agents go in --roles' }),
    flags: z.object({
        label: titleField('--label', '--label needs a name for the group'),
        roles: z.string().min(1, `--roles needs the roles as JSON, ${ROLES_SHAPE}`),
        cwd: z.string().min(1, '--cwd needs the path of a directory').optional(),
        reads: readsFlag,
        view: z.string().min(1, '--view needs the id of a canvas').optional(),
        mode: modeFlag
    }),
    async run({ flags, switches, dryRun }, call) {
        const roles = parseRoles(flags.roles);
        const tasked = switches.has('task');
        const started = await runAction(
            call,
            'team.start',
            {
                label: flags.label,
                roles: roles.map((role) => ({
                    title: role.title,
                    prompt: role.prompt,
                    provider: role.provider,
                    model: role.model ?? null,
                    terminal: role.terminal === true
                })),
                cwd: flags.cwd ?? null,
                reads: flags.reads === undefined ? null : idList(flags.reads, '--reads'),
                viewId: flags.view ?? null,
                mode: flags.mode ?? null,
                worktree: switches.has('worktree'),
                task: tasked
            },
            dryRun
        );
        const { group } = started;
        const edgeOf = (edge: (typeof started.agents)[number]['edge']): string =>
            edge === null ? '-' : dryRun ? `${edge.from} -> ${edge.to}` : (edge.edgeId ?? '-');
        if (dryRun) {
            return [
                ['dry-run', 'group', field(group.title), group.viewId, '-', '-'].join('\t'),
                ...started.agents.map((agent) =>
                    ['dry-run', agent.kind, field(agent.title), group.viewId, agent.provider, edgeOf(agent.edge), ...(tasked ? ['<new task>'] : [])].join('\t')
                ),
                ...started.reads.map((line) => ['dry-run', 'reads', `${line.from} -> ${line.to}`].join('\t'))
            ];
        }
        return [
            [group.nodeId, 'group', field(group.title), group.viewId, '-', '-'].join('\t'),
            ...started.agents.map((agent) =>
                [
                    agent.nodeId,
                    agent.kind,
                    field(agent.title),
                    group.viewId,
                    agent.provider,
                    edgeOf(agent.edge),
                    ...(agent.taskId === null ? [] : [agent.taskId])
                ].join('\t')
            ),
            ...started.reads.map((line) => ['reads', line.edgeId ?? '-', line.from, line.to].join('\t')),
            ...(tasked ? [nextLine(true)] : [])
        ];
    }
});
