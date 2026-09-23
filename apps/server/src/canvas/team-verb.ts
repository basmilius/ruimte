import { randomBytes } from 'node:crypto';
import { NODE_SIZE, type AgentKind, type ProjectEdge, type ProjectNode } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_PROMPT_LENGTH } from '../agents/pending-prompts.ts';
import { modelFlag, modelLines, selectionForOpening } from './model.ts';
import { providerFor } from '../providers/registry.ts';
import { AGENT_KINDS, agentNode, chatKinds, nameOf, terminalMode } from './agent-verb.ts';
import { DEPTH_LIMIT_LINES, MAX_OPENED_PER_CALLER, MAX_TEAM_DEPTH, depthForOpening } from './depth.ts';
import { MODE_LINES, modeFlag, modeForOpening } from './mode.ts';
import { readsFlag, readsIds, readsLines } from './link-verb.ts';
import { MAX_CANVAS_NODES, canvasFull, newId, nodesNamed } from './nodes.ts';
import { placeFree, placeTeam, TEAM_COLUMNS } from './placement.ts';
import { checkCwd } from './project-paths.ts';
import { TASK_LINES, nextLine, taskBrief } from './task-verbs.ts';
import { MAX_TASK_PROMPT_LENGTH, requireChatParent } from './tasks.ts';
import {
    DRY_RUN_PREVIEW,
    MAX_TITLE_LENGTH,
    OPENING_OFF_CANVAS,
    TITLE_LINE,
    VerbRefusal,
    canvasFor,
    defineVerb,
    field,
    lengthOf,
    newNode,
    placeOf,
    titleField
} from './verb.ts';
import { WORKTREE_LINES, branchSlug, branchesForWorktrees, freeBranch, makeWorktrees } from './worktree.ts';

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
    `flag\t--label L\trequired\tThe name of the group the agents land in, at most ${MAX_TITLE_LENGTH} characters`,
    `flag\t--roles J\trequired\tThe roles as JSON, ${ROLES_SHAPE}`,
    ...ROLES_LINES,
    'json\tA prompt is a JSON string, so a line break in it is \\n of JSON itself and nothing is escaped twice',
    `quoting\tThe JSON goes in single quotes, so an apostrophe in a prompt ends the quote early: write it as '\\'' or as \\u0027 inside the JSON string`,
    `example\truimte-context team --label "Parser work" --roles '[{"title":"Lexer","prompt":"Fix the tokenizer in src/lex.ts","provider":"claude"},{"title":"Reviewer","prompt":"Read the Lexer node and review its work","provider":"codex"},{"title":"Shell","prompt":"Run the lexer tests","provider":"claude","terminal":true}]'`,
    'prints\tid\tkind\ttitle\tview\tcli\tedge\ttask\tthe group first, its label in the title column and a dash for the CLI and the edge, then one line per role in the order of --roles, with the id of its task last under --task; the title is what tells two rows of one CLI apart',
    'prints\treads\tid\tfrom\tto\tone line per --reads node per role, under the roles: the line drawn from that node into that agent',
    'prints\tnext\tthe last line under --task, saying what to do while the tasks run',
    'flag\t--cwd P\toptional\tThe directory every agent starts in; a directory per role is --worktree',
    'flag\t--reads A,B\toptional\tNodes every role can read from its first turn, by id, separated by commas: a line is drawn from each of them into each role',
    'flag\t--view V\toptional\tThe canvas to add to, by view id; ruimte-context view list lists them. Without it the view you are in, when that is a canvas',
    'flag\t--mode M\toptional\tThe permission mode every role runs in: supervised, auto-accept-edits, auto or full-access, never wider than your own',
    'flag\t--worktree\tno value\tStarts every role in a git worktree of its own, on a new branch named after the role; not together with --cwd',
    `flag\t--task\tno value\tGives every role a task titled after the role, which its prompt describes; you are woken once, with the results of all roles, when the last of them settles; each prompt at most ${MAX_TASK_PROMPT_LENGTH} characters`,
    `flag\t--dry-run\tno value\tChecks everything and makes nothing; the first field of every line is dry-run and the last names the edge it would draw, as <from> -> <the role's title>; every role is checked before any is made, and ${DRY_RUN_PREVIEW}`,
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

const kindOf = (role: Role): 'chat' | 'terminal' => (role.terminal !== true && providerFor(role.provider).capabilities.chat ? 'chat' : 'terminal');

export const teamVerb = defineVerb({
    name: 'team',
    usage: `--label L --roles '${ROLES_SHAPE}' [--view V] [--cwd P] [--reads A,B] [--task] [--mode M] [--worktree] [--dry-run]`,
    summary: `Opens up to ${MAX_ROLES} agents at once in a group, each with an edge from you into it when you are a node on that canvas`,
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
        const place = placeOf(call);
        const roles = parseRoles(flags.roles);
        const selections = roles.map((role, index) => {
            try {
                return selectionForOpening(role.provider, kindOf(role) === 'chat', role.model);
            } catch (e) {
                if (e instanceof VerbRefusal) {
                    throw new VerbRefusal(e.code, `role ${index} (model): ${e.message}`, e.lines);
                }
                throw e;
            }
        });
        const tasked = switches.has('task');
        const long = tasked ? roles.findIndex((role) => role.prompt.length > MAX_TASK_PROMPT_LENGTH) : -1;
        if (long !== -1) {
            throw new VerbRefusal(
                'prompt-too-long',
                `role ${long} (prompt): ${roles[long]!.prompt.length} characters, and a task takes at most ${MAX_TASK_PROMPT_LENGTH}, since the child is also told how to report back`
            );
        }
        const depth = depthForOpening(call, 'team', roles.length);
        const ceiling = modeForOpening(call, flags.mode);
        const readIds = readsIds(flags.reads);
        const inWorktrees = switches.has('worktree');
        if (inWorktrees && flags.cwd !== undefined) {
            throw new VerbRefusal('worktree-and-cwd', '--worktree and --cwd both say where the agents start; give one of them');
        }

        const installed = await call.host.installedAgents();
        const missing = roles.findIndex((role) => !installed.includes(role.provider));
        if (missing !== -1) {
            const kind = roles[missing]!.provider;
            throw new VerbRefusal(
                'cli-not-installed',
                `role ${missing} (${kind}): ${nameOf(kind)} is not installed on this machine`,
                installed.length === 0
                    ? ['note\tNo agent CLI is installed on this machine']
                    : installed.map((candidate: AgentKind) => `cli\t${candidate}\t${nameOf(candidate)}`)
            );
        }

        // Everything that touches the disk or git runs before the lock, so a slow repository holds up no save.
        const cwd = flags.cwd === undefined ? undefined : await checkCwd(place.folder, flags.cwd, (folder) => call.host.worktreePaths(folder));
        const roleCwds: Array<string | undefined> = roles.map(() => cwd);
        let undoWorktrees = async (): Promise<void> => undefined;
        if (inWorktrees) {
            const taken = await branchesForWorktrees(call, place.folder);
            const branches = roles.map((role) => {
                const branch = freeBranch(branchSlug(role.title), taken);
                taken.add(branch);
                return branch;
            });
            if (!dryRun) {
                const made = await makeWorktrees(call, { folder: place.folder!, projectId: place.projectId }, branches);
                made.worktrees.forEach((worktree, index) => {
                    roleCwds[index] = worktree.path;
                });
                undoWorktrees = made.undo;
            }
        }
        const modes = roles.map((role) => (kindOf(role) === 'chat' ? flags.mode : terminalMode(call, flags.mode, ceiling)));

        return call.host
            .mutate(place.projectId, async (content) => {
                if (tasked) {
                    requireChatParent(content, call.caller);
                }
                const canvas = canvasFor(content, place, flags.view, OPENING_OFF_CANVAS);
                // The group counts too, which is the one node a caller does not name in --roles.
                if (canvas.nodes.length + roles.length + 1 > MAX_CANVAS_NODES) {
                    throw canvasFull(canvas, roles.length + 1);
                }

                const read = nodesNamed(content, canvas, readIds, { cannot: 'no line can run from it into the agents this opens' });
                const layout = placeTeam(roles.map((role) => NODE_SIZE[kindOf(role)]));
                const caller = canvas.nodes.find((node) => node.id === call.caller) ?? null;
                const origin = placeFree(canvas.nodes, layout.frame, caller);
                const label = flags.label;

                if (dryRun) {
                    return {
                        content: null,
                        result: [
                            ['dry-run', 'group', field(label), canvas.id, '-', '-'].join('\t'),
                            ...roles.map((role) =>
                                [
                                    'dry-run',
                                    kindOf(role),
                                    field(role.title),
                                    canvas.id,
                                    role.provider,
                                    // The ends rather than the word "edge", and the role rather than a placeholder every
                                    // row would share: the direction and the plan are what to read before anything is made.
                                    caller ? `${caller.id} -> ${newNode(field(role.title))}` : '-',
                                    ...(tasked ? ['<new task>'] : [])
                                ].join('\t')
                            ),
                            ...roles.flatMap((role) => read.map((node) => ['dry-run', 'reads', `${node.id} -> ${newNode(field(role.title))}`].join('\t')))
                        ]
                    };
                }

                const taken: string[] = [];
                const mint = (prefix: string): string => {
                    const id = newId(prefix, content, taken);
                    taken.push(id);
                    return id;
                };

                /* A group that is not collapsed holds whatever has its center inside the frame, the same
               rule the client reads membership by, so there is no memberIds to fill in here. */
                const groupId = mint('group');
                const group: ProjectNode = { id: groupId, kind: 'group', title: label, ...origin };
                const nodes: ProjectNode[] = [group];
                const edges: ProjectEdge[] = [];
                const lines = [[groupId, 'group', field(label), canvas.id, '-', '-'].join('\t')];
                const reading: string[] = [];
                const made: Array<{ id: string; title: string; prompt: string; chat: boolean; provider: AgentKind; line: number; index: number }> = [];

                for (const [index, role] of roles.entries()) {
                    const chat = kindOf(role) === 'chat';
                    const rect = layout.rects[index]!;
                    const id = mint(chat ? 'chat' : 'terminal');
                    nodes.push(
                        agentNode({
                            id,
                            chat,
                            kind: role.provider,
                            title: role.title,
                            rect: { ...rect, x: origin.x + rect.x, y: origin.y + rect.y },
                            cwd: roleCwds[index],
                            ...(modes[index] === undefined ? {} : { runtimeMode: modes[index] })
                        })
                    );
                    let edgeId = '-';
                    if (caller) {
                        edgeId = mint('edge');
                        edges.push({ id: edgeId, from: caller.id, to: id, label: 'context' });
                    }
                    for (const source of read) {
                        /* Your own line is the one every role already gets: naming yourself in --reads
                           is that line reported again, never a second one beside it. */
                        if (caller && source.id === caller.id) {
                            reading.push(['reads', edgeId, source.id, id].join('\t'));
                            continue;
                        }
                        const readEdgeId = mint('edge');
                        edges.push({ id: readEdgeId, from: source.id, to: id, label: 'context' });
                        reading.push(['reads', readEdgeId, source.id, id].join('\t'));
                    }
                    made.push({ id, title: role.title, prompt: role.prompt, chat, provider: role.provider, line: lines.length, index });
                    lines.push([id, chat ? 'chat' : 'terminal', field(role.title), canvas.id, role.provider, edgeId].join('\t'));
                }

                lines.push(...reading);
                if (tasked) {
                    lines.push(nextLine(true));
                }

                return {
                    landed: async () => {
                        const batchId = tasked ? `batch-${randomBytes(6).toString('hex')}` : undefined;
                        // Every task before any agent starts, so a role that is done at once never finds its team complete without the others.
                        for (const { id, title, prompt, line, index } of made) {
                            await call.host.recordMade({ projectId: place.projectId, nodeId: id, openedBy: call.caller, depth, agent: true });
                            const roleCwd = roleCwds[index];
                            if (inWorktrees && roleCwd !== undefined) {
                                await call.host.claimWorktree(place.folder!, roleCwd, id);
                            }
                            if (batchId !== undefined) {
                                const task = await call.host.tasks.open({
                                    projectId: place.projectId,
                                    parentId: call.caller,
                                    childId: id,
                                    title,
                                    prompt,
                                    batchId
                                });
                                lines[line] = `${lines[line]}\t${task.id}`;
                            }
                        }
                        for (const { id, prompt, chat, provider, index } of made) {
                            await call.host.holdPrompt(place.projectId, id, tasked ? `${prompt}${taskBrief(chat)}` : prompt);
                            await call.host.startAgent({
                                projectId: place.projectId,
                                nodeId: id,
                                openedBy: call.caller,
                                node: chat ? 'chat' : 'terminal',
                                provider,
                                ...(selections[index] ? { selection: selections[index] } : {}),
                                cwd: roleCwds[index] ?? place.folder,
                                ...(modes[index] === undefined ? {} : { runtimeMode: modes[index] })
                            });
                        }
                    },
                    content: {
                        ...content,
                        views: content.views.map((view) =>
                            view.id === canvas.id ? { ...canvas, nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...edges] } : view
                        )
                    },
                    result: lines
                };
            })
            .catch(async (e: unknown) => {
                await undoWorktrees();
                throw e;
            });
    }
});
