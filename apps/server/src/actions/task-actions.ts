import type { ActionHandlers } from '@ruimte/actions';
import { isAgentKind, isCanvasView, type ProjectContent, type ProjectNode, type Task } from '@ruimte/contracts';
import { ownViewOf, refuseOwnView } from '../canvas/own-view.ts';
import { readPromptFile, readResultFile } from '../canvas/project-paths.ts';
import { MAX_RESULT_LENGTH, MAX_TASK_PROMPT_LENGTH, requireChatParent, taskLine } from '../canvas/tasks.ts';
import { MAX_TITLE_LENGTH, VerbRefusal, field, orNote } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

const NEEDS_RESULT = '--result needs what came of the task, in quotes';

const NEEDS_PROMPT = '--prompt needs what the task asks, in quotes';

/*
 * Whether a task still asks anything of the node listing it. A task it gave is history once it settled
 * and its wake went out or never will (cancelled, or a parent nobody can wake); a task it was given is
 * history once it settled. An earlier run with the same titles otherwise reads as work still out.
 */
const isCurrentTask = (task: Task, nodeId: string): boolean => task.status === 'open' || (task.parentId === nodeId && task.wake === 'pending');

/* The title of a task nobody named: its first line, cut to what a name on the canvas fits. */
const titleFromPrompt = (prompt: string): string =>
    field(prompt.split('\n').find((line) => line.trim() !== '') ?? prompt)
        .trim()
        .slice(0, MAX_TITLE_LENGTH);

/* A node of this project, on whatever canvas it sits: a task travels by lineage, not over a canvas. */
const nodeOf = (content: ProjectContent, id: string): ProjectNode | undefined => {
    for (const view of content.views) {
        if (isCanvasView(view)) {
            const node = view.nodes.find((candidate) => candidate.id === id);
            if (node) {
                return node;
            }
        }
    }
    return undefined;
};

/* The agent nodes this caller opened itself, which is the whole of what it may set to work. */
const openedAgents = (content: ProjectContent, caller: string, madeBy: (nodeId: string) => string | null): ProjectNode[] =>
    content.views.flatMap((view) => (isCanvasView(view) ? view.nodes.filter((node) => isAgentKind(node.kind) && madeBy(node.id) === caller) : []));

export const taskActions: ActionHandlers<ServerActionContext> = {
    'task.list': async ({ all }, { actor, context }) => {
        const tasks = context.host.tasks.involving(actor.id);
        const listed = all ? tasks : tasks.filter((task) => isCurrentTask(task, actor.id));
        return { output: { tasks: listed, hidden: tasks.length - listed.length } };
    },
    'task.create': async ({ nodeId, prompt, promptFile, title }, { actor, context }) => {
        const { host, place } = context;
        const caller = actor.id;
        if (nodeId === caller) {
            throw new VerbRefusal('self-task', `${nodeId} is you; a task is what you give another agent`);
        }
        const content = await host.read(place.projectId);
        requireChatParent(content, caller);
        // Only the nodes this same call would accept, so a refusal answers with what can be asked instead.
        const lines = (): string[] =>
            orNote(
                openedAgents(content, caller, (id) => host.madeBy(id)).map((node) => `node\t${node.id}\t${node.kind}\t${field(node.title)}`),
                'You have opened no agent that is still in this project; ruimte-context agent --task opens one with a task of its own'
            );
        const target = nodeOf(content, nodeId);
        if (!target) {
            const own = ownViewOf(content, nodeId);
            if (own) {
                throw refuseOwnView(own, 'there is no node there to give a task to', lines());
            }
            throw new VerbRefusal('unknown-node', `${nodeId} is not a node of this project`, lines());
        }
        if (!isAgentKind(target.kind)) {
            throw new VerbRefusal('not-an-agent', `${nodeId} is a ${target.kind} node; only a terminal or a chat has an agent that could take a task`, lines());
        }
        // Only an agent the caller opened, as the daemon wrote it down: a line would let two agents set each other to work.
        if (host.madeBy(nodeId) !== caller) {
            throw new VerbRefusal('not-yours', `${nodeId} is not a node you opened; a task only goes to an agent you opened yourself`, [
                ...lines(),
                `see\truimte-context notify ${nodeId}\tsends it a message along a line, which it acts on itself and never reports back from`
            ]);
        }
        if (target.kind !== 'chat') {
            throw new VerbRefusal(
                'not-a-chat',
                `${nodeId} is a terminal node: a task has to start a turn, and nothing is typed into a shell a person can type in`,
                [
                    ...lines(),
                    `see\truimte-context notify ${nodeId}\tsends it a message its agent hears at the start of its next turn; a terminal is never given a turn either`,
                    'see\truimte-context agent --terminal --task\topens a terminal of its own with the task on the line its CLI starts with'
                ]
            );
        }
        const running = host.tasks.involving(nodeId).find((task) => task.childId === nodeId && task.status === 'open');
        if (running) {
            throw new VerbRefusal(
                'task-running',
                `${nodeId} is working on the task "${field(running.title)}" and takes one at a time; wait for its result, which wakes you`,
                [taskLine(running, caller), 'see\truimte-context agent --task\topens another agent for work that cannot wait']
            );
        }
        const state = await host.tasks.chatState(nodeId);
        if (state === 'none') {
            throw new VerbRefusal('no-agent', `${nodeId} runs no agent yet: nothing was started in it, so there is no turn a task could open`, lines());
        }

        if (prompt !== null && promptFile != null) {
            throw new VerbRefusal('prompt-twice', '--prompt and --prompt-file both say what the task asks; give one of them');
        }
        let text: string;
        if (promptFile != null) {
            text = await readPromptFile(place.folder, promptFile, (path) => host.worktreePaths(path));
        } else if (prompt !== null) {
            text = prompt;
        } else {
            throw new VerbRefusal('empty-prompt', NEEDS_PROMPT);
        }
        text = text.trim();
        if (text === '') {
            throw new VerbRefusal('empty-prompt', 'The prompt is empty; a task is what it asks, so say what that agent is to do');
        }
        if (text.length > MAX_TASK_PROMPT_LENGTH) {
            throw new VerbRefusal(
                'prompt-too-long',
                `The prompt is ${text.length} characters and a task takes at most ${MAX_TASK_PROMPT_LENGTH}, since the agent is also told how to report back; put the rest in a file and tell it to read that`
            );
        }
        const task = await host.tasks.give({
            projectId: place.projectId,
            parentId: caller,
            childId: nodeId,
            title: title ?? titleFromPrompt(text),
            prompt: text
        });
        return { output: { taskId: task.id, nodeId, at: state === 'running' ? 'waiting' : 'now' } };
    },
    'task.complete': async ({ result, resultFile }, { actor, context }) => {
        const { host, place } = context;
        const caller = actor.id;
        if (result !== null && resultFile != null) {
            throw new VerbRefusal('result-twice', '--result and --result-file both carry the result; give one of them');
        }
        const open = host.tasks.involving(caller).find((task) => task.childId === caller && task.status === 'open');
        if (!open) {
            throw new VerbRefusal(
                'no-open-task',
                'You have no open task to report on: done is for a node another chat opened with --task, until that task settles',
                host.tasks
                    .involving(caller)
                    .filter((task) => task.childId === caller)
                    .map((task) => taskLine(task, caller))
            );
        }
        let text: string;
        if (resultFile != null) {
            text = await readResultFile(place.folder, resultFile, (path) => host.worktreePaths(path));
        } else if (result !== null) {
            text = result;
        } else {
            throw new VerbRefusal('empty-result', NEEDS_RESULT);
        }
        text = text.trim();
        if (text === '') {
            throw new VerbRefusal('empty-result', 'The result is empty; say what came of the task, even when that is that nothing could be done');
        }
        if (text.length > MAX_RESULT_LENGTH) {
            throw new VerbRefusal(
                'result-too-long',
                `The result is ${text.length} characters and at most ${MAX_RESULT_LENGTH} fit; put the rest in a file and name it in the result`
            );
        }
        // Settling is what owes the parent its wake, once, through the outbox.
        const settled = await host.tasks.done(caller, text);
        if (!settled) {
            throw new VerbRefusal('no-open-task', 'Your task settled a moment ago, before this result arrived');
        }
        return { output: { taskId: settled.id, parentId: settled.parentId } };
    }
};
