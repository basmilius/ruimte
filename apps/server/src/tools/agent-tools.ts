import { ToolRefusal } from '@adecore/agents/context';
import { modeField } from '@adecore/agents/providers';
import { MAX_OPENED_PER_CALLER, MAX_PROMPT_LENGTH } from '@ruimte/actions';
import { z } from 'zod';
import { AGENT_KINDS, agentKindField, chatKinds } from '../canvas/agents.ts';
import { MAX_TITLE_LENGTH, field, lengthOf, titleField } from '../canvas/host.ts';
import { effortFlag, modelFlag, modelLines } from '../canvas/model.ts';
import { idList } from '../canvas/nodes.ts';
import { shippedProviders } from '../providers/table.ts';
import { defineActionTool, runAction } from './action-tool.ts';
import { nextLine } from './task-tools.ts';
import { defineToolkit, PROJECT_INPUT, VIEW_INPUT, type GuideTopic } from './tool.ts';

/* As many as one caller may have open at once, so a single team can fill that allowance and no more. */
export const MAX_ROLES = MAX_OPENED_PER_CALLER;

export const ROLES_SHAPE = '[{"title": "Lexer", "prompt": "Fix the tokenizer", "provider": "claude"}]';

const ANSWERS_SHAPE = `{"<question id>":"<answer>",...}`;

const MODE_INPUT = modeField.describe('Only when the person asks for another mode');

const READS_INPUT = z
    .string({ error: 'reads needs one or more node ids, separated by commas' })
    .min(1, 'reads needs one or more node ids, separated by commas')
    .optional()
    .describe('Node ids it reads from the start');

const CWD_INPUT = z.string({ error: 'cwd needs the path of a directory' }).min(1, 'cwd needs the path of a directory').optional();

const MACHINE_INPUT = z
    .string({ error: 'machine needs the name or id of a machine' })
    .min(1, 'machine needs the name or id of a machine')
    .optional()
    .describe('A linked machine; needs task');

const DRY_RUN_INPUT = z.boolean({ error: 'dry_run is true or false' }).optional();

const ACCOUNT_INPUT = z
    .string({ error: 'account needs the id of an account' })
    .min(1, 'account needs the id of an account')
    .optional()
    .describe("An account from a person's @account:<cli>/<id>");

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
    provider: agentKindField('provider'),
    model: modelFlag,
    terminal: z.boolean({ error: 'terminal is true or false' }).optional(),
    effort: effortFlag,
    account: ACCOUNT_INPUT
});

type Role = z.infer<typeof RoleSchema>;

const RolesSchema = z
    .array(RoleSchema, { error: 'roles is a JSON array of roles' })
    .min(1, `roles has no roles in it; a team is between 1 and ${MAX_ROLES} of them`)
    .max(MAX_ROLES, { error: (issue) => `roles has ${lengthOf(issue.input)} roles and a team takes at most ${MAX_ROLES}` });

/* The shape, said the same way in the guide and under a refusal, so a bad call is one read away from a good one. */
const ROLES_LINES: readonly string[] = [
    `roles\tshape\t${ROLES_SHAPE}`,
    `roles\ttitle\trequired\tThe title of the node, at most ${MAX_TITLE_LENGTH} characters; the session never renames over it`,
    `roles\tprompt\trequired\tWhat that agent starts working on, at most ${MAX_PROMPT_LENGTH} characters`,
    `roles\tprovider\trequired\t${AGENT_KINDS.join(', ')}, or the kind of an agent a person installed from the ACP registry`,
    `roles\tterminal\toptional\ttrue opens a terminal node instead of a chat node; a CLI without a chat backend is a terminal anyway (only ${chatKinds().join(', ')} have one)`,
    "roles\tmodel\toptional\tThe model id for a chat role, with that model's default options; omitted uses the composer preference. Refused for terminals and unknown models",
    "roles\teffort\toptional\tThe reasoning effort for a chat role, one its model offers; omitted keeps the person's last pick when the model offers it, else the model's default. Refused for terminals",
    "roles\taccount\toptional\tThe id of an account a person named in this chat as @account:<cli>/<id>, for the role's provider; omitted inherits yours",
    ...shippedProviders()
        .filter((provider) => provider.capabilities.chat)
        .flatMap(modelLines),
    `roles\tcount\tbetween 1 and ${MAX_ROLES}`
];

const GUIDES: readonly GuideTopic[] = [
    {
        name: 'roles',
        lines: [
            ...ROLES_LINES.filter((line) => line.startsWith('roles\t')),
            'json\tA prompt is a JSON string, so a line break in it is \\n of JSON itself and nothing is escaped twice'
        ]
    },
    {
        name: 'models',
        lines: shippedProviders()
            .filter((provider) => provider.capabilities.chat)
            .flatMap(modelLines)
    }
];

/*
 * Which role is wrong and why. zod says `[2].prompt`, and an agent that wrote the JSON needs the
 * index back to find the object it typed, so the path is spelled out in front of the sentence.
 */
function rolesMessage(error: z.ZodError): string {
    const issue = error.issues[0];

    if (!issue) {
        return 'roles is not a list of roles';
    }

    const [index, key] = issue.path;

    if (typeof index !== 'number') {
        return issue.message;
    }

    return `role ${index}${typeof key === 'string' ? ` (${key})` : ''}: ${issue.message}`;
}

function parseRoles(raw: string): Role[] {
    let json: unknown;

    try {
        json = JSON.parse(raw);
    } catch (e) {
        throw new ToolRefusal('bad-roles-json', `roles is not JSON: ${e instanceof Error ? e.message : 'it could not be read'}`, [...ROLES_LINES]);
    }

    const parsed = RolesSchema.safeParse(json);

    if (!parsed.success) {
        throw new ToolRefusal('bad-roles', rolesMessage(parsed.error), [...ROLES_LINES]);
    }

    return parsed.data;
}

/* `answers` as the map `agent.answer` takes, refused by name when it is not one. */
function parseAnswers(text: string): Record<string, string> {
    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch {
        throw new ToolRefusal('bad-answers-json', `answers is not JSON; it takes ${ANSWERS_SHAPE}`);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !Object.values(parsed).every((value) => typeof value === 'string')) {
        throw new ToolRefusal('bad-answers-json', `answers takes one object of strings, ${ANSWERS_SHAPE}`);
    }

    return parsed as Record<string, string>;
}

const agentStart = defineActionTool('agent', {
    name: 'agent_start',
    action: 'agent.start',
    description: 'Starts an agent in this project.',
    input: z.object({
        cli: agentKindField('cli').describe(AGENT_KINDS.join(', ')),
        project: PROJECT_INPUT,
        prompt: z.string({ error: 'prompt is what the agent starts on, as text' }).optional(),
        cwd: CWD_INPUT,
        reads: READS_INPUT,
        view: VIEW_INPUT,
        beside: z
            .string({ error: 'beside needs the id of a node on that canvas' })
            .min(1, 'beside needs the id of a node on that canvas')
            .optional()
            .describe('The node it goes right of'),
        group: z
            .string({ error: 'group needs the id of a group node on that canvas' })
            .min(1, 'group needs the id of a group node on that canvas')
            .optional()
            .describe('A group node it goes in'),
        title: titleField('title', 'title needs a title').optional(),
        task: titleField('task', 'task needs the title of the task').optional().describe('A task title; its result wakes you'),
        mode: MODE_INPUT,
        model: modelFlag.describe('Ids: guide topic models'),
        effort: effortFlag,
        account: ACCOUNT_INPUT,
        branch: z.string({ error: 'branch needs the name of a branch' }).min(1, 'branch needs the name of a branch').optional(),
        request_id: z
            .string({ error: 'request_id takes 1 to 128 characters of letters, digits and . _ : -' })
            .regex(/^[A-Za-z0-9._:-]{1,128}$/, 'request_id takes 1 to 128 characters of letters, digits and . _ : -')
            .optional()
            .describe('Your id, so a retry lands once'),
        base: z
            .string({ error: 'base needs a branch, tag or commit' })
            .min(1, 'base needs a branch, tag or commit')
            .optional()
            .describe('With worktree, where a new branch starts'),
        machine: MACHINE_INPUT,
        terminal: z.boolean({ error: 'terminal is true or false' }).optional(),
        worktree: z.boolean({ error: 'worktree is true or false' }).optional(),
        dry_run: DRY_RUN_INPUT
    }),
    async run(input, call) {
        const dryRun = input.dry_run === true;
        const started = await runAction(
            call,
            'agent.start',
            {
                provider: input.cli,
                terminal: input.terminal === true,
                prompt: input.prompt ?? null,
                promptFile: null,
                cwd: input.cwd ?? null,
                reads: input.reads === undefined ? null : idList(input.reads, 'reads'),
                viewId: input.view ?? null,
                beside: input.beside ?? null,
                group: input.group ?? null,
                title: input.title ?? null,
                task: input.task ?? null,
                model: input.model ?? null,
                mode: input.mode ?? null,
                worktree: input.worktree === true,
                branch: input.branch ?? null,
                requestId: input.request_id ?? null,
                base: input.base ?? null,
                machine: input.machine ?? null,
                effort: input.effort ?? null,
                account: input.account ?? null
            },
            dryRun
        );
        const { edge } = started;

        if (dryRun) {
            // The ends rather than the word "edge": the direction is the thing to check before anything is made.
            return [
                [
                    'dry-run',
                    started.kind,
                    started.viewId ?? '-',
                    started.provider,
                    edge ? `${edge.from} -> ${edge.to}` : '-',
                    ...(input.task === undefined ? [] : ['<new task>'])
                ].join('\t'),
                ...started.reads.map((line) => ['dry-run', 'reads', `${line.from} -> ${line.to}`].join('\t'))
            ];
        }

        return [
            [
                started.nodeId,
                started.kind,
                started.viewId ?? '-',
                started.provider,
                edge?.edgeId ?? '-',
                ...(started.taskId === null ? [] : [started.taskId])
            ].join('\t'),
            ...started.reads.map((line) => ['reads', line.edgeId ?? '-', line.from, line.to].join('\t')),
            ...(input.task === undefined ? [] : [nextLine(false)])
        ];
    }
});

const agentTeam = defineActionTool('agent', {
    name: 'agent_team',
    action: 'team.start',
    description: `Starts a team of up to ${MAX_ROLES} agents in this project.`,
    counter: 'team',
    input: z.object({
        project: PROJECT_INPUT,
        label: titleField('label', 'label needs a name for the group').describe('The group the agents land in'),
        roles: z
            .string({ error: `roles needs the roles as JSON, ${ROLES_SHAPE}` })
            .min(1, `roles needs the roles as JSON, ${ROLES_SHAPE}`)
            .describe('Format: guide topic roles'),
        cwd: CWD_INPUT,
        reads: READS_INPUT,
        view: VIEW_INPUT,
        mode: MODE_INPUT,
        machine: MACHINE_INPUT,
        task: z.boolean({ error: 'task is true or false' }).optional().describe('A task per role; you wake once all settle'),
        worktree: z.boolean({ error: 'worktree is true or false' }).optional(),
        dry_run: DRY_RUN_INPUT
    }),
    async run(input, call) {
        const dryRun = input.dry_run === true;
        const roles = parseRoles(input.roles);
        const tasked = input.task === true;
        const started = await runAction(
            call,
            'team.start',
            {
                label: input.label,
                roles: roles.map((role) => ({
                    title: role.title,
                    prompt: role.prompt,
                    provider: role.provider,
                    model: role.model ?? null,
                    terminal: role.terminal === true,
                    effort: role.effort ?? null,
                    account: role.account ?? null
                })),
                cwd: input.cwd ?? null,
                reads: input.reads === undefined ? null : idList(input.reads, 'reads'),
                viewId: input.view ?? null,
                mode: input.mode ?? null,
                worktree: input.worktree === true,
                task: tasked,
                machine: input.machine ?? null
            },
            dryRun
        );
        const { group } = started;
        const edgeOf = (edge: (typeof started.agents)[number]['edge']): string =>
            edge === null ? '-' : dryRun ? `${edge.from} -> ${edge.to}` : (edge.edgeId ?? '-');
        const taskOf = (taskId: string | null): string[] => (dryRun ? (tasked ? ['<new task>'] : []) : taskId === null ? [] : [taskId]);

        return [
            ...(group ? [[dryRun ? 'dry-run' : group.nodeId, 'group', field(group.title), group.viewId, '-', '-'].join('\t')] : []),
            ...started.agents.map((agent) =>
                [
                    dryRun ? 'dry-run' : agent.nodeId,
                    agent.kind,
                    field(agent.title),
                    group?.viewId ?? '-',
                    agent.provider,
                    edgeOf(agent.edge),
                    ...taskOf(agent.taskId)
                ].join('\t')
            ),
            ...started.reads.map((line) =>
                (dryRun ? ['dry-run', 'reads', `${line.from} -> ${line.to}`] : ['reads', line.edgeId ?? '-', line.from, line.to]).join('\t')
            ),
            ...(tasked && !dryRun ? [nextLine(true)] : [])
        ];
    }
});

const NEEDS_FORK = 'agent_fork needs id, the chat to fork, one you opened yourself';

const agentFork = defineActionTool('agent', {
    name: 'agent_fork',
    action: 'chat.fork',
    description: 'Forks an AI chat you opened, after one of its turns, into a new chat.',
    counter: 'fork',
    input: z.object({
        id: z.string({ error: NEEDS_FORK }).min(1, NEEDS_FORK),
        title: titleField('title', 'title needs the title of the fork').optional(),
        branch: z
            .string({ error: 'branch needs the name of a new branch' })
            .trim()
            .min(1, 'branch needs the name of a new branch')
            .optional()
            .describe('A new worktree on this branch')
    }),
    async run(input, call) {
        const forked = await runAction(call, 'chat.fork', { chatId: input.id, turnId: null, title: input.title ?? null, branch: input.branch ?? null });

        return [
            `fork\t${forked.nodeId}\t${forked.viewId}\t${forked.branch ?? '-'}`,
            `next\tGive it work with task_new with id ${forked.nodeId} and a prompt; its result wakes you once it settled`
        ];
    }
});

const NEEDS_IDS = 'agent_answer needs id, the agent that asked, and request, the id of its request';

const agentAnswer = defineActionTool('agent', {
    name: 'agent_answer',
    action: 'agent.answer',
    description: 'Answers a question an agent you opened waits on.',
    counter: 'answer',
    input: z.object({
        id: z.string({ error: NEEDS_IDS }).min(1, NEEDS_IDS),
        request: z.string({ error: NEEDS_IDS }).min(1, NEEDS_IDS).describe('As its > Question line names it'),
        answer: z.string({ error: 'answer is text' }).optional().describe('For one question, a choice label or your own words'),
        answers: z
            .string({ error: 'answers needs a JSON object' })
            .min(1, 'answers needs a JSON object')
            .optional()
            .describe('For several, JSON keyed by question id')
    }),
    async run(input, call) {
        const answered = await runAction(call, 'agent.answer', {
            nodeId: input.id,
            requestId: input.request,
            answer: input.answer ?? null,
            answers: input.answers === undefined ? null : parseAnswers(input.answers)
        });

        return [`answered\t${answered.nodeId}\t${answered.requestId}`];
    }
});

export const agentToolkit = defineToolkit('agent', [agentStart, agentTeam, agentFork, agentAnswer], GUIDES);
