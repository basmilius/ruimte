import { AgentKindSchema, NODE_SIZE, type AgentKind, type ProjectCanvasView, type ProjectEdge, type ProjectNode } from '@ruimte/contracts';
import { z } from 'zod';
import { MAX_PROMPT_LENGTH } from '../agents/pending-prompts.ts';
import { providerFor } from '../providers/registry.ts';
import { DEPTH_LIMIT_LINES, depthForOpening } from './depth.ts';
import { MAX_CANVAS_NODES, canvasFull, newId, nodeLines } from './node-verb.ts';
import { groupMembers, placeBeside, placeFree, placeInGroup, type Rect } from './placement.ts';
import { checkCwd, readPromptFile } from './project-paths.ts';
import { unescapeText } from './text-escapes.ts';
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
    'prints\tid\tkind\tview\tcli\tedge\tthe new node, its kind (terminal or chat), the canvas it landed on, the CLI it runs and the id of the edge drawn into it',
    `flag\t--chat\tno value\tMakes a chat node instead of a terminal node; only a CLI with a chat backend takes it (${chatKinds().join(', ')})`,
    `flag\t--prompt T\toptional\tWhat the agent starts working on; \\n, \\t and \\\\ are read as escapes, at most ${MAX_PROMPT_LENGTH} characters`,
    'flag\t--prompt-file F\toptional\tThe same prompt out of a file, for one with exact bytes; not together with --prompt',
    'flag\t--cwd P\toptional\tThe directory the agent starts in',
    'flag\t--view V\toptional\tThe canvas to add to, by view id; ruimte-context views lists them',
    'flag\t--beside N\toptional\tPuts the node directly right of node N, top edges level',
    'flag\t--group G\toptional\tPuts the node inside group node G of that canvas; not together with --beside',
    `flag\t--title T\toptional\tThe title, at most ${MAX_TITLE_LENGTH} characters; without one the node is called after the CLI, and the session may rename it`,
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
    ...DEPTH_LIMIT_LINES,
    'note\tThe node starts working the moment a client shows it; with nobody looking, the daemon holds the prompt until one does'
];

export interface AgentNodeSpec {
    id: string;
    chat: boolean;
    kind: AgentKind;
    title: string | undefined;
    rect: Rect;
    cwd: string | undefined;
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
    ...(spec.cwd === undefined ? {} : { cwd: spec.cwd })
});

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
    usage: `<${AGENT_KINDS.join('|')}> [--chat] [--prompt T | --prompt-file F] [--cwd P] [--view V] [--beside N] [--group G] [--title T] [--dry-run]`,
    summary: 'Opens an agent node that starts working, with an edge from you into it so it can read what you have',
    detail: AGENT_DETAIL,
    dryRun: true,
    positionals: z.tuple([z.enum(AGENT_KINDS, { error: KIND_MESSAGE })], {
        error: (issue) => (issue.code === 'too_big' ? 'agent takes one CLI and nothing else; what it should do goes in --prompt' : KIND_MESSAGE)
    }),
    switches: ['chat'],
    flags: z.object({
        prompt: z.string().optional(),
        'prompt-file': z.string().min(1, '--prompt-file needs the path of a file').optional(),
        cwd: z.string().min(1, '--cwd needs the path of a directory').optional(),
        view: z.string().min(1, '--view needs the id of a canvas').optional(),
        beside: z.string().min(1, '--beside needs the id of a node on that canvas').optional(),
        group: z.string().min(1, '--group needs the id of a group node on that canvas').optional(),
        title: titleField('--title', '--title needs a title').optional()
    }),
    async run({ positionals: [kind], flags, switches, dryRun }, call) {
        const place = placeOf(call);
        const depth = depthForOpening(call, 'agent', 1);
        const chat = switches.has('chat');
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
        const cwd = flags.cwd === undefined ? undefined : await checkCwd(place.folder, flags.cwd, (folder) => call.host.worktreePaths(folder));

        return call.host.mutate(place.projectId, async (content) => {
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
                return { content: null, result: [['dry-run', chat ? 'chat' : 'terminal', canvas.id, kind, edge].join('\t')] };
            }

            const id = newId(chat ? 'chat' : 'terminal', content);
            const node = agentNode({ id, chat, kind, title: flags.title, rect, cwd });
            const edge: ProjectEdge | null = caller ? { id: newId('edge', content, [id]), from: caller.id, to: id, label: 'context' } : null;
            const nodes = [...canvas.nodes.map((candidate) => (group && candidate.id === group.id ? grownGroup(candidate, inGroup, id) : candidate)), node];

            // Written under the project's own lock, before the node is on disk, so a client that
            // reacts to project.changed can never mount the node while its depth is still coming.
            await call.host.recordOpened(place.projectId, id, call.caller, depth);
            if (prompt !== null) {
                await call.host.holdPrompt(place.projectId, id, prompt);
            }
            return {
                content: {
                    ...content,
                    views: content.views.map((view) =>
                        view.id === canvas.id ? { ...canvas, nodes, edges: edge ? [...canvas.edges, edge] : canvas.edges } : view
                    )
                },
                result: [[id, node.kind, canvas.id, kind, edge?.id ?? '-'].join('\t')]
            };
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
