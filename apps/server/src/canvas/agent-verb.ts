import { MAX_PROMPT_LENGTH } from '@ruimte/actions';
import { z } from 'zod';
import { defineStandaloneActionVerb, runAction } from './action-verb.ts';
import { AGENT_KINDS, REGISTRY_KINDS_LINE, agentKindField, chatKinds } from './agents.ts';
import { DEPTH_LIMIT_LINES } from './depth.ts';
import { readsFlag, readsLines } from './link-verb.ts';
import { modeFlag } from '@adecore/agents/providers';
import { MODE_FLAG_HELP, MODE_LINES } from './mode.ts';
import { MACHINE_LINES } from './remote-agent.ts';
import { PROJECT_FLAG, PROJECT_LINE } from './reach.ts';
import { effortFlag, modelFlag, modelLines } from './model.ts';
import { MAX_CANVAS_NODES, idList } from './nodes.ts';
import { TASK_LINES, nextLine } from './task-verbs.ts';
import { MAX_TASK_PROMPT_LENGTH } from './tasks.ts';
import { unescapeText } from './text-escapes.ts';
import { DRY_RUN_PREVIEW, MAX_TITLE_LENGTH, TITLE_LINE, titleField, VIEW_FLAG } from './verb.ts';
import { WORKTREE_LINES } from './worktree.ts';

const KIND_MESSAGE = `agent needs a CLI: ${AGENT_KINDS.join(', ')}`;

const AGENT_DETAIL: readonly string[] = [
    ...chatKinds().flatMap(modelLines),
    'prints\tid\tkind\tview\tcli\tedge\ttask\tthe new agent, its kind (chat or terminal), its canvas (- when hidden), the CLI it runs, its edge (- when none was drawn) and, with --task, the task id',
    'prints\treads\tid\tfrom\tto\tone line per --reads node, under the first: the line drawn from it into the new agent',
    'prints\tnext\tthe last line under --task, saying what to do while the task runs',
    `kinds\tchat\tThe default for ${chatKinds().join(', ')}: the CLI as a thread in the node, fixed to that CLI, with no model picker on the composer; its last answer settles a task`,
    REGISTRY_KINDS_LINE,
    'kinds\tterminal\tThat CLI running in a shell, which is what the person sees and can type in; the only kind for a CLI without a chat backend, and a terminal child has to call done to settle a task',
    'edge\tThe edge runs from you into the new node, which is the direction that makes you readable to it: it can run ruimte-context read on your id',
    'edge\tA line only joins two nodes of one canvas, so from any other view the edge column shows -',
    'edge\tOne way only: the edge makes you readable to the child. You can read an agent you opened with ruimte-context read <its id> through its lineage, including a hidden agent, without a line back',
    'edge\truimte-context link list lists what is drawn on the canvas now',
    ...readsLines('the new agent'),
    'without a prompt\tLeave --prompt out and the node opens with the CLI waiting, so the person types the first thing themselves',
    'groups\truimte-context node list lists the nodes of a canvas; a row of kind group is what --group takes',
    'where\tWithout --view an agent on a canvas opens a node there; from a chat view it opens a hidden agent, reachable through its task row and ruimte-context read <id>. --view explicitly places it on that canvas',
    'where\tWithout --beside and --group the first free spot right of the caller, or right of everything when the caller is none of its nodes',
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
    ...MACHINE_LINES,
    PROJECT_LINE,
    'project\tWith --project the agent opens on the canvas of that project that --view names, with no edge to you; --cwd and --worktree stay inside that project, and --machine works only from your own',
    'retry\t--request-id R: the same id with the same command answers with the node, task and worktree the first call made, also after the machine restarted; another command under the same id is refused',
    'operation\tStarting is not succeeding: ruimte-context operation get agent.start:<id> says whether the agent is queued, running, completed, failed or cancelled, from its task when it has one',
    'note\tThe machine starts the node right away, whether or not anyone has its canvas open; a client that shows it later joins what runs'
];

export const agentVerb = defineStandaloneActionVerb({
    name: 'agent',
    action: 'agent.start',
    usage: `<${AGENT_KINDS.join('|')}> [--terminal] [--prompt T | --prompt-file F] [--cwd P] [--reads A,B] [--view V] [--beside N] [--group G] [--title T] [--task T] [--model M] [--effort E] [--mode M] [--worktree [--branch B] [--base R]] [--machine M] [--request-id R] [--dry-run]`,
    params: [
        { syntax: '<cli>', need: 'required', field: 'provider', text: AGENT_KINDS.join(', ') },
        {
            syntax: '--terminal',
            need: 'no value',
            field: 'terminal',
            more: `a CLI without a chat backend is a terminal anyway (only ${chatKinds().join(', ')} have one)`
        },
        {
            syntax: '--prompt T',
            need: 'optional',
            field: 'prompt',
            more: `\\n, \\t and \\\\ are read as escapes, at most ${MAX_PROMPT_LENGTH} characters`
        },
        { syntax: '--prompt-file F', need: 'optional', field: 'promptFile', more: 'not together with --prompt' },
        { syntax: '--cwd P', need: 'optional', field: 'cwd' },
        {
            syntax: '--reads A,B',
            need: 'optional',
            field: 'reads',
            text: 'Nodes the new agent can read from its first turn, by id, separated by commas: a line is drawn from each of them into it'
        },
        { syntax: '--view V', need: 'optional', field: 'viewId', more: 'ruimte-context view list lists them' },
        { syntax: '--beside N', need: 'optional', field: 'beside', text: 'Puts the node directly right of node N, top edges level' },
        { syntax: '--group G', need: 'optional', field: 'group', text: 'Puts the node inside group node G of that canvas; not together with --beside' },
        {
            syntax: '--title T',
            need: 'optional',
            field: 'title',
            text: `The title, at most ${MAX_TITLE_LENGTH} characters; without one the node is called after the CLI, and the session may rename it`
        },
        {
            syntax: '--task T',
            need: 'optional',
            field: 'task',
            text: `Gives the new agent a task titled T, which the prompt describes and whose result wakes you; needs a prompt of at most ${MAX_TASK_PROMPT_LENGTH} characters, and the title of the node is T unless --title says otherwise`
        },
        {
            syntax: '--model M',
            need: 'optional',
            field: 'model',
            more: 'omitted uses the composer preference. Refused for terminals and unknown models'
        },
        {
            syntax: '--effort E',
            need: 'optional',
            field: 'effort',
            more: "one the model offers, as the model lines list them; omitted keeps the person's last pick when the model offers it, else the model's default. Refused for terminals"
        },
        { syntax: '--mode M', need: 'optional', field: 'mode', more: MODE_FLAG_HELP },
        { syntax: '--worktree', need: 'no value', field: 'worktree', more: 'not together with --cwd' },
        {
            syntax: '--branch B',
            need: 'optional',
            field: 'branch',
            text: 'With --worktree: the branch to use instead of one named after the task or the title; an existing branch is checked out as it is'
        },
        {
            syntax: '--machine M',
            need: 'optional',
            field: 'machine',
            text: 'Runs the agent on another machine this project is linked to, by its name or id; needs --task. The task is delivered when that machine is reachable, however long that takes'
        },
        {
            syntax: '--request-id R',
            need: 'optional',
            field: 'requestId',
            text: 'An id of your choosing, 1 to 128 characters of letters, digits and . _ : -; a retry with the same id and the same command answers with what the first call made'
        },
        {
            syntax: '--base R',
            need: 'optional',
            field: 'base',
            text: 'With --worktree: the branch, tag or commit a new branch starts at instead of HEAD'
        },
        {
            syntax: '--dry-run',
            need: 'no value',
            text: `Checks everything and makes nothing; the first field is dry-run and the last names the edge it would draw, as <from> -> <new node>; ${DRY_RUN_PREVIEW}`
        }
    ],
    detail: AGENT_DETAIL,
    dryRun: true,
    positionals: z.tuple([agentKindField('agent')], {
        error: (issue) => (issue.code === 'too_big' ? 'agent takes one CLI and nothing else; what it should do goes in --prompt' : KIND_MESSAGE)
    }),
    switches: ['terminal', 'worktree'],
    flags: z.object({
        project: PROJECT_FLAG,
        prompt: z.string().optional(),
        'prompt-file': z.string().min(1, '--prompt-file needs the path of a file').optional(),
        cwd: z.string().min(1, '--cwd needs the path of a directory').optional(),
        reads: readsFlag,
        view: VIEW_FLAG,
        beside: z.string().min(1, '--beside needs the id of a node on that canvas').optional(),
        group: z.string().min(1, '--group needs the id of a group node on that canvas').optional(),
        title: titleField('--title', '--title needs a title').optional(),
        task: titleField('--task', '--task needs the title of the task').optional(),
        mode: modeFlag,
        model: modelFlag,
        effort: effortFlag,
        branch: z.string().min(1, '--branch needs the name of a branch').optional(),
        'request-id': z
            .string()
            .regex(/^[A-Za-z0-9._:-]{1,128}$/, '--request-id takes 1 to 128 characters of letters, digits and . _ : -')
            .optional(),
        base: z.string().min(1, '--base needs a branch, tag or commit').optional(),
        machine: z.string().min(1, '--machine needs the name or id of a machine').optional()
    }),
    async run({ positionals: [kind], flags, switches, dryRun }, call) {
        const started = await runAction(
            call,
            'agent.start',
            {
                provider: kind,
                terminal: switches.has('terminal'),
                prompt: flags.prompt === undefined ? null : unescapeText(flags.prompt),
                promptFile: flags['prompt-file'] ?? null,
                cwd: flags.cwd ?? null,
                reads: flags.reads === undefined ? null : idList(flags.reads, '--reads'),
                viewId: flags.view ?? null,
                beside: flags.beside ?? null,
                group: flags.group ?? null,
                title: flags.title ?? null,
                task: flags.task ?? null,
                model: flags.model ?? null,
                mode: flags.mode ?? null,
                worktree: switches.has('worktree'),
                branch: flags.branch ?? null,
                requestId: flags['request-id'] ?? null,
                base: flags.base ?? null,
                machine: flags.machine ?? null,
                effort: flags.effort ?? null
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
                    ...(flags.task === undefined ? [] : ['<new task>'])
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
            ...(flags.task === undefined ? [] : [nextLine(false)])
        ];
    }
});
