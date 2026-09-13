import { NODE_SIZE, type AgentKind, type ProjectEdge, type ProjectNode } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_PROMPT_LENGTH } from '../agents/pending-prompts.ts';
import { providerFor } from '../providers/registry.ts';
import { AGENT_KINDS, agentNode, chatKinds, nameOf, newNode } from './agent-verb.ts';
import { DEPTH_LIMIT_LINES, MAX_TEAM_DEPTH, depthForOpening } from './depth.ts';
import { MAX_CANVAS_NODES, canvasFull, newId } from './node-verb.ts';
import { placeFree, placeTeam, TEAM_COLUMNS } from './placement.ts';
import { checkCwd } from './project-paths.ts';
import { MAX_TITLE_LENGTH, TITLE_LINE, VerbRefusal, canvasFor, defineVerb, field, lengthOf, placeOf, titleField } from './verb.ts';

/* The design's number: past eight the group is a wall of terminals and the bill is somebody's day. */
export const MAX_ROLES = 8;

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
    chat: z.boolean({ error: 'chat is true or false' }).optional()
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
    `roles\tchat\toptional\ttrue opens a chat node instead of a terminal node; only a CLI with a chat backend takes it (${chatKinds().join(', ')})`,
    `roles\tcount\tbetween 1 and ${MAX_ROLES}`
];

const TEAM_DETAIL: readonly string[] = [
    `flag\t--label L\trequired\tThe name of the group the agents land in, at most ${MAX_TITLE_LENGTH} characters`,
    `flag\t--roles J\trequired\tThe roles as JSON, ${ROLES_SHAPE}`,
    ...ROLES_LINES,
    'json\tA prompt is a JSON string, so a line break in it is \\n of JSON itself and nothing is escaped twice',
    `quoting\tThe JSON goes in single quotes, so an apostrophe in a prompt ends the quote early: write it as '\\'' or as \\u0027 inside the JSON string`,
    `example\truimte-context team --label "Parser work" --roles '[{"title":"Lexer","prompt":"Fix the tokenizer in src/lex.ts","provider":"claude"},{"title":"Reviewer","prompt":"Read the Lexer node and review its work","provider":"codex","chat":true}]'`,
    'prints\tid\tkind\ttitle\tview\tcli\tedge\tthe group first, its label in the title column and a dash for the CLI and the edge, then one line per role in the order of --roles; the title is what tells two rows of one CLI apart',
    'flag\t--cwd P\toptional\tThe directory every agent starts in; a directory per role is not a thing',
    'flag\t--view V\toptional\tThe canvas to add to, by view id; ruimte-context views lists them',
    "flag\t--dry-run\tno value\tChecks everything and makes nothing; the first field of every line is dry-run and the last names the edge it would draw, as <from> -> <the role's title>",
    'edges\tOne edge per role, from you into that agent, so each of them can read you with ruimte-context read',
    'edges\tOne way only: you do not read them through it, and the roles do not read each other',
    "edges\truimte-context link --to <the role's id> draws the line back, which is how you read what a role has done; its id is the first field of that role's row",
    'edges\truimte-context edges lists what is drawn on the canvas now',
    'where\tThe group lands on the first free spot right of you, or right of everything when you are not on that canvas',
    `group\tThe agents stand in rows of at most ${TEAM_COLUMNS} inside the frame, and the frame is sized to hold them`,
    'refusal\tA role that is wrong is named by its place in the array, counting from 0',
    'paths\t--cwd is resolved against the project folder and has to stay inside it or a worktree of its repository',
    'prompt\tA terminal role gets its prompt on the line its CLI is started with, a chat role as the first message of its thread; it is delivered once and never written into project.json',
    `limit\tA canvas holds at most ${MAX_CANVAS_NODES} nodes, the group among them`,
    TITLE_LINE,
    ...DEPTH_LIMIT_LINES,
    `depth\tA role lands at depth ${MAX_TEAM_DEPTH}: it may open a single agent of its own with agent, and a team of its own is refused`,
    'note\tEvery agent starts working the moment a client shows it; with nobody looking, the daemon holds the prompts until one does'
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

const kindOf = (role: Role): 'chat' | 'terminal' => (role.chat === true ? 'chat' : 'terminal');

export const teamVerb = defineVerb({
    name: 'team',
    usage: `--label L --roles '${ROLES_SHAPE}' [--view V] [--cwd P] [--dry-run]`,
    summary: `Opens up to ${MAX_ROLES} agents at once in a group, each with an edge from you into it`,
    detail: TEAM_DETAIL,
    dryRun: true,
    positionals: z.tuple([], { error: 'team takes no arguments, only flags; the agents go in --roles' }),
    flags: z.object({
        label: titleField('--label', '--label needs a name for the group'),
        roles: z.string().min(1, `--roles needs the roles as JSON, ${ROLES_SHAPE}`),
        cwd: z.string().min(1, '--cwd needs the path of a directory').optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional()
    }),
    async run({ flags, dryRun }, call) {
        const place = placeOf(call);
        const roles = parseRoles(flags.roles);
        const depth = depthForOpening(call, 'team', roles.length);

        for (const [index, role] of roles.entries()) {
            if (role.chat === true && !providerFor(role.provider).capabilities.chat) {
                throw new VerbRefusal(
                    'no-chat-backend',
                    `role ${index} (${role.provider}): ${nameOf(role.provider)} has no chat backend; leave chat out and it opens as a terminal agent`,
                    chatKinds().map((candidate) => `cli\t${candidate}\t${nameOf(candidate)}\ttakes chat`)
                );
            }
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

        return call.host.mutate(place.projectId, async (content) => {
            const canvas = canvasFor(content, place, flags.view);
            // The group counts too, which is the one node a caller does not name in --roles.
            if (canvas.nodes.length + roles.length + 1 > MAX_CANVAS_NODES) {
                throw canvasFull(canvas, roles.length + 1);
            }

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
                                caller ? `${caller.id} -> ${newNode(field(role.title))}` : '-'
                            ].join('\t')
                        )
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
                        cwd
                    })
                );
                let edgeId = '-';
                if (caller) {
                    edgeId = mint('edge');
                    edges.push({ id: edgeId, from: caller.id, to: id, label: 'context' });
                }
                // Written under the project's own lock, before the nodes are on disk, so a client that
                // reacts to project.changed can never mount one while its prompt or its depth is still coming.
                await call.host.recordMade({ projectId: place.projectId, nodeId: id, openedBy: call.caller, depth, agent: true });
                await call.host.holdPrompt(place.projectId, id, role.prompt);
                lines.push([id, chat ? 'chat' : 'terminal', field(role.title), canvas.id, role.provider, edgeId].join('\t'));
            }

            return {
                content: {
                    ...content,
                    views: content.views.map((view) =>
                        view.id === canvas.id ? { ...canvas, nodes: [...canvas.nodes, ...nodes], edges: [...canvas.edges, ...edges] } : view
                    )
                },
                result: lines
            };
        });
    }
});
