import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MAX_PROMPT_LENGTH } from '@ruimte/actions';
import { MAX_TASK_PROMPT_LENGTH, taskBrief, taskFirstPrompt } from '../canvas/tasks.ts';
import { ROLES_SHAPE } from './agent-tools.ts';
import { canvasFixture, type CanvasFixture, TOKENS } from './canvas-fixture-test-helpers.ts';
import { nextLine, taskToolkit } from './task-tools.ts';

let fx: CanvasFixture;

beforeEach(async () => {
    fx = await canvasFixture();
});

afterEach(async () => {
    await fx.dispose();
});

describe('task list', () => {
    // The chat view `chat-1` is a chat, the one kind of caller that can be woken with a result.
    const give = (input: Record<string, unknown>) => fx.invoke('agent_start', { cli: 'claude', view: 'main', ...input }, 'chat');

    test('agent task from a chat records an open task, titles the node after it and tells the child how to report back', async () => {
        const { status, lines } = await give({ task: 'Lexer', prompt: 'fix the tokenizer' });
        expect(status).toBe(200);
        expect(lines).toHaveLength(2);
        expect(lines[1]).toBe(nextLine(false));
        const [id, kind, , , , taskId] = lines[0]!.split('\t');
        expect(kind).toBe('chat');
        expect(fx.tasks.get(taskId!)).toMatchObject({
            parentId: 'chat-1',
            childId: id,
            title: 'Lexer',
            prompt: 'fix the tokenizer',
            status: 'open',
            wake: 'pending'
        });
        expect((await fx.nodeOnDisk(id!))?.title).toBe('Lexer');
        // The record keeps the assignment as it was given; only the child hears how to report back, beside the prompt.
        expect(fx.held).toEqual([
            { projectId: fx.projectId, nodeId: id!, prompt: 'fix the tokenizer', brief: taskFirstPrompt('fix the tokenizer', true).brief! }
        ]);
        expect(taskBrief(true)).toContain(fx.held[0]!.brief!);
    });

    test('a task whose prompt is a slash command keeps the brief in it, since a CLI hears nothing in front of one', async () => {
        const { lines } = await give({ task: 'Review', prompt: '/review the lexer' });
        const [id] = lines[0]!.split('\t');
        expect(fx.held).toEqual([{ projectId: fx.projectId, nodeId: id!, prompt: `/review the lexer${taskBrief(true)}` }]);
    });

    test('a terminal agent cannot give a task, since nothing can wake it with the result', async () => {
        const { status, lines } = await fx.invoke('agent_start', { cli: 'claude', task: 'Lexer', prompt: 'fix it' });
        expect(status).toBe(422);
        expect(lines[0]).toStartWith('refused\tnot-a-chat-parent\tOnly a chat can give a task, and you are a terminal');
        expect(fx.started).toEqual([]);
        expect((await fx.invoke('agent_team', { label: 'Crew', task: true, roles: ROLES_SHAPE })).lines[0]).toStartWith('refused\tnot-a-chat-parent\t');
    });

    test('a task needs a prompt that leaves room for the line about reporting back', async () => {
        expect((await give({ task: 'Lexer' })).lines[0]).toStartWith('refused\ttask-needs-prompt\t');
        const long = 'x'.repeat(MAX_TASK_PROMPT_LENGTH + 1);
        expect((await give({ task: 'Lexer', prompt: long })).lines[0]).toStartWith('refused\tprompt-too-long\t');
        expect((await give({ task: 'Lexer', prompt: 'go', dry_run: true })).lines[0]).toEndWith('\t<new task>');
        expect(fx.tasks.involving('chat-1')).toEqual([]);
    });

    test('the brief fits the room kept for it, sends a chat to its last answer and a terminal to done in plain quotes', () => {
        for (const chat of [true, false]) {
            expect(taskBrief(chat).length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH - MAX_TASK_PROMPT_LENGTH);
        }
        // A child that is told about done calls it even when its last answer already reports back.
        expect(taskBrief(true)).not.toContain('done');
        expect(taskBrief(false)).toContain('call task_done with the result');
    });

    test('a chat child hears that its last message reports back also where its task names a tool, which task_done says too', () => {
        const done = taskToolkit.tools.find((tool) => tool.name === 'task_done');

        // A task often says to report with task_done; told that no tool call is needed, a child wrote its name under the answer.
        expect(taskBrief(true)).not.toContain('no tool call is needed');
        expect(taskBrief(true)).toContain('also where the task names a tool for it');
        expect(done?.description).toContain("a chat child's last message does the same");
    });

    test('team task gives every role a task of its own', async () => {
        const roles = JSON.stringify([
            { title: 'Lexer', prompt: 'fix the tokenizer', provider: 'claude', terminal: true },
            { title: 'Docs', prompt: 'write the docs', provider: 'claude' }
        ]);
        const { lines } = await fx.invoke('agent_team', { label: 'Crew', task: true, roles, view: 'main' }, 'chat');
        const rows = lines.slice(1, -1).map((line) => line.split('\t'));
        expect(rows.map((row) => fx.tasks.get(row[6]!)?.title)).toEqual(['Lexer', 'Docs']);
        expect(lines.at(-1)).toBe(nextLine(true));
        // A terminal has no notes, so its brief rides in the prompt.
        expect(fx.held.map((entry) => [entry.prompt, entry.brief])).toEqual([
            [`fix the tokenizer${taskBrief(false)}`, undefined],
            ['write the docs', taskFirstPrompt('write the docs', true).brief]
        ]);
    });

    test('done settles the open task of the caller, and tasks lists it from both sides', async () => {
        const [childId, , , , , taskId] = (await give({ task: 'Lexer', prompt: 'fix it' })).lines[0]!.split('\t');
        TOKENS.child = childId!;
        try {
            expect((await fx.invoke('task_done', { result: 'no tasks here' }, 'term')).lines[0]).toStartWith('refused\tno-open-task\t');
            expect((await fx.invoke('task_done', {}, 'child')).lines[0]).toStartWith('refused\tempty-result\t');
            expect((await fx.invoke('task_done', { result: 'Fixed\nboth bugs' }, 'child')).lines).toEqual([`done\t${taskId}\tchat-1`]);
            expect(fx.tasks.get(taskId!)).toMatchObject({ status: 'done', result: { text: 'Fixed\nboth bugs', source: 'done' } });
            expect((await fx.invoke('task_done', { result: 'again' }, 'child')).lines[0]).toStartWith('refused\tno-open-task\t');
            expect((await fx.invoke('task_list', {}, 'chat')).lines).toEqual([`task\t${taskId}\tgave\tdone\t${childId}\tLexer\tpending\tFixed\t-`]);
            // The child is done with a task that settled, while the parent still waits for the wake.
            expect((await fx.invoke('task_list', {}, 'child')).lines).toEqual([
                'note\tNo task is open or waiting to wake you; 1 older task is hidden, settled and already reported; task_list with all lists them'
            ]);
            expect((await fx.invoke('task_list', { all: true }, 'child')).lines).toEqual([`task\t${taskId}\tgiven\tdone\tchat-1\tLexer\tpending\tFixed\t-`]);
            expect((await fx.invoke('task_list', {}, 'term')).lines).toEqual([
                'note\tYou have given no task and were given none; agent_start with task gives one'
            ]);
        } finally {
            delete TOKENS.child;
        }
    });
    test('tasks leaves out what settled and already woke the parent, and all brings the history back', async () => {
        const [, , , , , earlier] = (await give({ task: 'Lexer', prompt: 'fix it' })).lines[0]!.split('\t');
        await fx.tasks.settle(earlier!, 'done', { text: 'Fixed', source: 'done', at: 1 }, 1);
        await fx.tasks.markWoken([earlier!]);
        const [laterChild, , , , , later] = (await give({ task: 'Lexer', prompt: 'fix it again' })).lines[0]!.split('\t');

        expect((await fx.invoke('task_list', {}, 'chat')).lines).toEqual([
            `task\t${later}\tgave\topen\t${laterChild}\tLexer\tpending\t\t-`,
            'note\t1 older task is hidden, settled and already reported; task_list with all lists them'
        ]);
        expect((await fx.invoke('task_list', { all: true }, 'chat')).lines.map((line) => line.split('\t')[1])).toEqual([earlier, later]);
    });
});
