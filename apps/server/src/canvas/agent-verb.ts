import { AgentKindSchema, NODE_SIZE, type AgentKind, type ProjectCanvasView, type ProjectEdge, type ProjectNode, type RuntimeMode } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_PROMPT_LENGTH } from '../agents/pending-prompts.ts';
import { DEFAULT_RUNTIME_MODE } from '../providers/launch.ts';
import { providerFor } from '../providers/registry.ts';
import { DEPTH_LIMIT_LINES, depthForOpening } from './depth.ts';
import { MODE_LINES, modeFlag, modeForOpening, narrowerMode } from './mode.ts';
import { MAX_CANVAS_NODES, canvasFull, newId, nodeLines } from './node-verb.ts';
import { groupMembers, placeBeside, placeFree, placeInGroup, type Rect } from './placement.ts';
import { checkCwd, readPromptFile } from './project-paths.ts';
import { MAX_TASK_PROMPT_LENGTH, TASK_LINES, requireChatParent, taskBrief } from './task-verbs.ts';
import { unescapeText } from './text-escapes.ts';
import { WORKTREE_LINES, branchSlug, branchesForWorktrees, freeBranch, makeWorktrees } from './worktree.ts';
import { MAX_TITLE_LENGTH, TITLE_LINE, VerbRefusal, canvasFor, defineVerb, field, orNote, placeOf, titleField, type VerbCall } from './verb.ts';

export const AGENT_KINDS = AgentKindSchema.options;

/* What a dry run calls the node it is not making, so the edge it names still has two ends; a team
   puts the role's title in it, since its rows are otherwise the same for two roles of one CLI. */
export const newNode = (name = 'new node'): string => `<${name}>`;

export const NEW_NODE = newNode();

/* The CLIs with a chat backend; the rest only ever runs in a shell, which is what `--chat` refuses. */
export const chatKinds = (): AgentKind[] => AGENT_KINDS.filter((kind) => providerFor(kind).capabilities.chat);

export const nameOf = (kind: AgentKind): string => providerFor(kind).name;

const KIND_MESSAGE = `agent needs a CLI: ${AGENT_KINDS.join(', ')}`;

const AGENT_DETAIL: readonly string[] = [
    `argument\t<cli>\trequired\t${AGENT_KINDS.join(', ')}`,
    'prints\tid\tkind\tview\tcli\tedge\ttask\tthe new node, its kind (terminal or chat), the canvas it landed on, the CLI it runs, the id of the edge drawn into it and, with --task, the id of the task',
    `flag\t--chat\tno value\tMakes a chat node instead of a terminal node; only a CLI with a chat backend takes it (${chatKinds().join(', ')})`,
    `flag\t--prompt T\toptional\tWhat the agent starts working on; \\n, \\t and \\\\ are read as escapes, at most ${MAX_PROMPT_LENGTH} characters`,
    'flag\t--prompt-file F\toptional\tThe same prompt out of a file, for one with exact bytes; not together with --prompt',
    'flag\t--cwd P\toptional\tThe directory the agent starts in',
    'flag\t--view V\toptional\tThe canvas to add to, by view id; ruimte-context views lists them',
    'flag\t--beside N\toptional\tPuts the node directly right of node N, top edges level',
    'flag\t--group G\toptional\tPuts the node inside group node G of that canvas; not together with --beside',
    `flag\t--title T\toptional\tThe title, at most ${MAX_TITLE_LENGTH} characters; without one the node is called after the CLI, and the session may rename it`,
    `flag\t--task T\toptional\tGives the new agent a task titled T, which the prompt describes and whose result wakes you; needs a prompt of at most ${MAX_TASK_PROMPT_LENGTH} characters, and the title of the node is T unless --title says otherwise`,
    'flag\t--mode M\toptional\tThe permission mode the agent runs in: supervised, auto-accept-edits, auto or full-access, never wider than your own',
    'flag\t--worktree\tno value\tStarts the agent in a git worktree of its own on a new branch; not together with --cwd',
    'flag\t--branch B\toptional\tWith --worktree: the branch to use instead of one named after the task or the title; an existing branch is checked out as it is',
    'flag\t--dry-run\tno value\tChecks everything and makes nothing; the first field is dry-run and the last names the edge it would draw, as <from> -> <new node>',
    'kinds\tterminal\tThat CLI running in a shell, which is what the person sees and can type in',
    'kinds\tchat\tThe CLI as a thread in the node, fixed to that CLI, with no model picker on the composer',
    'edge\tThe edge runs from you into the new node, which is the direction that makes you readable to it: it can run ruimte-context read on your id',
    'edge\tOne way only: you do not read the new agent through it. ruimte-context link --to <its id> draws the line back when you want that too',
    'edge\truimte-context edges lists what is drawn on the canvas now',
    'without a prompt\tLeave --prompt out and the node opens with the CLI waiting, so the person types the first thing themselves',
    'groups\truimte-context nodes lists the nodes of a canvas; a row of kind group is what --group takes',
    'where\tWithout --view the canvas the caller is a node on; a caller that is a view of its own must name one',
    'where\tWithout --beside and --group the first free spot right of the caller, or right of everything when the caller is not on that canvas',
    'group\tThe node lands in a row under the title bar of the group, which grows when it has no room; a collapsed group also takes the id into its members',
    'paths\t--cwd and --prompt-file are resolved against the project folder, never against your own directory; both may also be absolute',
    'paths\tBoth have to stay inside the project folder or a worktree of its repository',
    'prompt\tA terminal agent gets it on the line its CLI is started with, a chat agent as the first message of the thread; it is delivered once and never written into project.json',
    `quoting\tThe prompt is one shell word: an apostrophe in it ends a single-quoted argument early, so write it as '\\'' or put the prompt in --prompt-file`,
    `limit\tA canvas holds at most ${MAX_CANVAS_NODES} nodes`,
    TITLE_LINE,
    ...TASK_LINES,
    ...DEPTH_LIMIT_LINES,
    ...MODE_LINES,
    ...WORKTREE_LINES,
    'note\tThe machine starts the node right away, whether or not anyone has its canvas open; a client that shows it later joins what runs'
];

export interface AgentNodeSpec {
    id: string;
    chat: boolean;
    kind: AgentKind;
    title: string | undefined;
    rect: Rect;
    cwd: string | undefined;
    /* Terminal only: the mode its CLI starts in, kept on the node so a reload starts it the same way. */
    runtimeMode?: RuntimeMode;
}

/* The node a person's own click would have made: titled after the CLI, and a chat fixed to it, so
   its composer shows a badge instead of a model picker (`addAgentNode` in the client). */
export const agentNode = (spec: AgentNodeSpec): ProjectNode => ({
    id: spec.id,
    kind: spec.chat ? 'chat' : 'terminal',
    title: spec.title ?? nameOf(spec.kind),
    // A title the agent chose is not one the session may rename, the rule a person's typing follows.
    ...(spec.title === undefined ? {} : { titleSource: 'user' as const }),
    ...spec.rect,
    provider: spec.kind,
    ...(spec.chat ? { providerFixed: true } : {}),
    ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
    ...(spec.chat || spec.runtimeMode === undefined ? {} : { runtimeMode: spec.runtimeMode })
});

/* The mode a terminal agent is written down with: the one asked for, else the person's default narrowed to the caller's. */
export const terminalMode = (call: VerbCall, requested: RuntimeMode | undefined, ceiling: RuntimeMode): RuntimeMode =>
    requested ?? narrowerMode(call.host.terminalModePreference() ?? DEFAULT_RUNTIME_MODE, ceiling);

const groupLines = (canvas: ProjectCanvasView): string[] =>
    orNote(
        canvas.nodes.filter((node) => node.kind === 'group').map((node) => `group\t${node.id}\t${field(node.title)}`),
        `${canvas.id} has no groups on it yet; team opens one of its own, and a person groups nodes on the canvas`
    );

/* The prompt, from whichever flag carried it, checked against the one length a line into a shell survives. */
const promptOf = async (flags: { prompt?: string; 'prompt-file'?: string }, call: VerbCall, folder: string | null): Promise<string | null> => {
    if (flags.prompt !== undefined && flags['prompt-file'] !== undefined) {
        throw new VerbRefusal('prompt-twice', '--prompt and --prompt-file both say what to start on; give one of them');
    }
    let prompt: string | null = null;
    if (flags.prompt !== undefined) {
        prompt = unescapeText(flags.prompt);
    } else if (flags['prompt-file'] !== undefined) {
        prompt = await readPromptFile(folder, flags['prompt-file'], (path) => call.host.worktreePaths(path));
    }
    if (prompt === null) {
        return null;
    }
    prompt = prompt.trim();
    if (prompt === '') {
        throw new VerbRefusal('empty-prompt', 'The prompt is empty; leave the flag out to open an agent that waits for its person');
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
        throw new VerbRefusal(
            'prompt-too-long',
            `The prompt is ${prompt.length} characters and at most ${MAX_PROMPT_LENGTH} fit on the line a CLI is started with; put the rest in a file and tell the agent to read it`
        );
    }
    return prompt;
};

export const agentVerb = defineVerb({
    name: 'agent',
    usage: `<${AGENT_KINDS.join('|')}> [--chat] [--prompt T | --prompt-file F] [--cwd P] [--view V] [--beside N] [--group G] [--title T] [--task T] [--mode M] [--worktree [--branch B]] [--dry-run]`,
    summary: 'Opens an agent node that starts working, with an edge from you into it so it can read what you have',
    detail: AGENT_DETAIL,
    dryRun: true,
    positionals: z.tuple([z.enum(AGENT_KINDS, { error: KIND_MESSAGE })], {
        error: (issue) => (issue.code === 'too_big' ? 'agent takes one CLI and nothing else; what it should do goes in --prompt' : KIND_MESSAGE)
    }),
    switches: ['chat', 'worktree'],
    flags: z.object({
        prompt: z.string().optional(),
        'prompt-file': z.string().min(1, '--prompt-file needs the path of a file').optional(),
        cwd: z.string().min(1, '--cwd needs the path of a directory').optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional(),
        beside: z.string().min(1, '--beside needs the id of a node on that canvas').optional(),
        group: z.string().min(1, '--group needs the id of a group node on that canvas').optional(),
        title: titleField('--title', '--title needs a title').optional(),
        task: titleField('--task', '--task needs the title of the task').optional(),
        mode: modeFlag,
        branch: z.string().min(1, '--branch needs the name of a branch').optional()
    }),
    async run({ positionals: [kind], flags, switches, dryRun }, call) {
        const place = placeOf(call);
        const depth = depthForOpening(call, 'agent', 1);
        const ceiling = modeForOpening(call, flags.mode);
        const chat = switches.has('chat');
        const inWorktree = switches.has('worktree');
        if (flags.branch !== undefined && !inWorktree) {
            throw new VerbRefusal('branch-needs-worktree', '--branch names the branch of a worktree; add --worktree');
        }
        if (inWorktree && flags.cwd !== undefined) {
            throw new VerbRefusal('worktree-and-cwd', '--worktree and --cwd both say where the agent starts; give one of them');
        }
        if (chat && !providerFor(kind).capabilities.chat) {
            throw new VerbRefusal(
                'no-chat-backend',
                `${nameOf(kind)} has no chat backend; leave --chat out and it opens as a terminal agent`,
                chatKinds().map((candidate) => `cli\t${candidate}\t${nameOf(candidate)}\ttakes --chat`)
            );
        }
        if (flags.beside !== undefined && flags.group !== undefined) {
            throw new VerbRefusal('two-places', '--beside and --group both say where the node goes; give one of them');
        }

        const installed = await call.host.installedAgents();
        if (!installed.includes(kind)) {
            throw new VerbRefusal(
                'cli-not-installed',
                `${nameOf(kind)} is not installed on this machine`,
                installed.length === 0
                    ? ['note\tNo agent CLI is installed on this machine']
                    : installed.map((candidate) => `cli\t${candidate}\t${nameOf(candidate)}`)
            );
        }

        // Everything that touches the disk or git runs before the lock, so a slow repository holds up no save.
        const prompt = await promptOf(flags, call, place.folder);
        if (flags.task !== undefined && prompt === null) {
            throw new VerbRefusal('task-needs-prompt', '--task gives a task and the prompt is what it asks; add --prompt or --prompt-file');
        }
        if (flags.task !== undefined && prompt !== null && prompt.length > MAX_TASK_PROMPT_LENGTH) {
            throw new VerbRefusal(
                'prompt-too-long',
                `The prompt is ${prompt.length} characters and a task takes at most ${MAX_TASK_PROMPT_LENGTH}, since the child is also told how to report back; put the rest in a file and tell the agent to read it`
            );
        }
        let cwd = flags.cwd === undefined ? undefined : await checkCwd(place.folder, flags.cwd, (folder) => call.host.worktreePaths(folder));
        const runtimeMode = chat ? flags.mode : terminalMode(call, flags.mode, ceiling);
        let undoWorktrees = async (): Promise<void> => undefined;
        if (inWorktree) {
            const branches = await branchesForWorktrees(call, place.folder);
            const branch = flags.branch ?? freeBranch(branchSlug(flags.task ?? flags.title ?? kind), branches);
            if (!dryRun) {
                const made = await makeWorktrees(call, place.folder!, [branch]);
                cwd = made.worktrees[0]!.path;
                undoWorktrees = made.undo;
            }
        }

        return call.host
            .mutate(place.projectId, async (content) => {
                if (flags.task !== undefined) {
                    requireChatParent(content, call.caller);
                }
                const canvas = canvasFor(content, place, flags.view);
                if (canvas.nodes.length + 1 > MAX_CANVAS_NODES) {
                    throw canvasFull(canvas, 1);
                }
                const anchor = flags.beside === undefined ? undefined : canvas.nodes.find((node) => node.id === flags.beside);
                if (flags.beside !== undefined && !anchor) {
                    throw new VerbRefusal('unknown-node', `${flags.beside} is not a node on ${canvas.id}`, nodeLines(canvas));
                }
                const group = flags.group === undefined ? undefined : canvas.nodes.find((node) => node.id === flags.group && node.kind === 'group');
                if (flags.group !== undefined && !group) {
                    throw new VerbRefusal('unknown-group', `${flags.group} is not a group on ${canvas.id}`, groupLines(canvas));
                }

                const size = NODE_SIZE[chat ? 'chat' : 'terminal'];
                const caller = canvas.nodes.find((node) => node.id === call.caller) ?? null;
                const inGroup = group ? placeInGroup(group, groupMembers(group, canvas.nodes), size) : null;
                const rect = inGroup?.rect ?? (anchor ? placeBeside(anchor, size) : placeFree(canvas.nodes, size, caller));

                if (dryRun) {
                    // The ends rather than the word "edge": the direction is the thing to check before anything is made.
                    const edge = caller ? `${caller.id} -> ${NEW_NODE}` : '-';
                    return {
                        content: null,
                        result: [['dry-run', chat ? 'chat' : 'terminal', canvas.id, kind, edge, ...(flags.task === undefined ? [] : ['<new task>'])].join('\t')]
                    };
                }

                const id = newId(chat ? 'chat' : 'terminal', content);
                const node = agentNode({ id, chat, kind, title: flags.title ?? flags.task, rect, cwd, ...(runtimeMode === undefined ? {} : { runtimeMode }) });
                const edge: ProjectEdge | null = caller ? { id: newId('edge', content, [id]), from: caller.id, to: id, label: 'context' } : null;
                const nodes = [...canvas.nodes.map((candidate) => (group && candidate.id === group.id ? grownGroup(candidate, inGroup, id) : candidate)), node];
                const result = [[id, node.kind, canvas.id, kind, edge?.id ?? '-'].join('\t')];

                return {
                    landed: async () => {
                        await call.host.recordMade({ projectId: place.projectId, nodeId: id, openedBy: call.caller, depth, agent: true });
                        // Before the agent starts, so a child that is done at once finds its task open.
                        if (flags.task !== undefined && prompt !== null) {
                            const task = await call.host.tasks.open({
                                projectId: place.projectId,
                                parentId: call.caller,
                                childId: id,
                                title: flags.task,
                                prompt
                            });
                            result[0] = `${result[0]}\t${task.id}`;
                        }
                        if (prompt !== null) {
                            await call.host.holdPrompt(place.projectId, id, flags.task === undefined ? prompt : `${prompt}${taskBrief(chat)}`);
                        }
                        await call.host.startAgent({
                            projectId: place.projectId,
                            nodeId: id,
                            openedBy: call.caller,
                            node: chat ? 'chat' : 'terminal',
                            provider: kind,
                            cwd: cwd ?? place.folder,
                            ...(runtimeMode === undefined ? {} : { runtimeMode })
                        });
                    },
                    content: {
                        ...content,
                        views: content.views.map((view) =>
                            view.id === canvas.id ? { ...canvas, nodes, edges: edge ? [...canvas.edges, edge] : canvas.edges } : view
                        )
                    },
                    result
                };
            })
            .catch(async (e: unknown) => {
                await undoWorktrees();
                throw e;
            });
    }
});

/* The group as it has to become: big enough for what was put in it, and naming it while it is collapsed. */
const grownGroup = (group: ProjectNode, placement: ReturnType<typeof placeInGroup> | null, memberId: string): ProjectNode => {
    if (!placement) {
        return group;
    }
    const collapsed = group.collapsed === true;
    return {
        ...group,
        w: placement.grown.w,
        // While it is collapsed its own height is the header; the height it opens to is what grew.
        ...(collapsed ? { expandedHeight: placement.grown.h } : { h: placement.grown.h }),
        ...(collapsed ? { memberIds: [...(group.memberIds ?? []), memberId] } : {})
    };
};
