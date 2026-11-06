import { resolve } from 'node:path';
import { ChatItemSchema, activeSubagents, notResumedNote, taskIdOfRow, toolFileEdit, type ChatItem } from '@adecore/agent-contracts';
import { writeGenerated } from '../../../apps/ios/Scripts/generated.ts';
import { adecore, adecoreDependency, adecorePackageRoot, compactFixture, seeded } from './adecore-port.ts';

/*
 * The cases the phone's chat is held to, with the answer the desktop's chat logic in `@adecore/agents-react` gives:
 * the rows a thread is drawn as, the sentences of a run of calls, the marks of a tool, and the files a call changes.
 */
const destination = resolve(import.meta.dir, '../../../apps/ios/Tests/Fixtures/ports-chat.json');

interface TimelineRow {
    kind: string;
    id: string;
    [key: string]: unknown;
}

interface Options {
    expandedGroups: Set<string>;
    expandedTurns: Set<string>;
    expandedSubagents: Set<string>;
    activeTurnId: string | null;
    forkedTurns?: Set<string>;
}

const root = adecorePackageRoot('@adecore/agents-react');
const chatLogic = `${root}/dist/chat/logic`;

const { default: i18next } = await adecoreDependency<{ default: { init(options: unknown): Promise<unknown> } }>('i18next', '@adecore/agents-react');
const { default: agentChat } = await adecore<{ default: Record<string, unknown> }>(`${root}/dist/locales/en/agent-chat.js`);

await i18next.init({ lng: 'en', fallbackLng: 'en', ns: ['agent-chat'], resources: { en: { 'agent-chat': agentChat } }, interpolation: { escapeValue: false } });

const derive = await adecore<{
    deriveTimelineRows(items: ChatItem[], options: Options): TimelineRow[];
    summarizeGroup(tools: ChatItem[]): string;
}>(`${chatLogic}/timeline.js`);

let clock = 1000;

function base(id: string, turnId: string | null): { id: string; createdAt: number; turnId: string | null } {
    clock += 10;

    return { id, createdAt: clock, turnId };
}

type Fields = Record<string, unknown>;

const turn = (id: string, state: 'running' | 'done' | 'aborted' | 'error' = 'done', extra: Fields = {}): Fields => ({
    ...base(id, id),
    kind: 'turn',
    state,
    endedAt: state === 'running' ? null : clock + 12_400,
    costUsd: 0,
    ...extra
});

const user = (id: string, turnId: string | null = 't1', text = 'do it'): Fields => ({ ...base(id, turnId), kind: 'user', text });
const reply = (id: string, turnId: string | null = 't1', text = 'Done.', extra: Fields = {}): Fields => ({
    ...base(id, turnId),
    kind: 'assistant',
    text,
    streaming: false,
    ...extra
});
const thinking = (id: string, turnId: string | null = 't1', text = 'Looking at the entry first.', extra: Fields = {}): Fields => ({
    ...base(id, turnId),
    kind: 'thinking',
    text,
    streaming: false,
    endedAt: null,
    ...extra
});
const tool = (id: string, name = 'Read', input: unknown = { file_path: 'a.ts' }, state = 'done', turnId: string | null = 't1', extra: Fields = {}): Fields => ({
    ...base(id, turnId),
    kind: 'tool',
    toolUseId: id,
    name,
    input,
    output: null,
    state,
    parentToolUseId: null,
    ...extra
});
const agent = (id: string, turnId: string | null = 't1', extra: Fields = {}): Fields => ({
    ...base(id, turnId),
    kind: 'subagent',
    toolUseId: `use-${id}`,
    description: 'Look around',
    subagentType: null,
    prompt: null,
    background: false,
    status: 'done',
    startedAt: clock,
    finishedAt: clock + 100,
    summary: null,
    result: null,
    usage: null,
    lastTool: null,
    itemsTruncated: false,
    ...extra
});
const note = (id: string, turnId: string | null = 't1', extra: Fields = {}): Fields => ({
    ...base(id, turnId),
    kind: 'note',
    level: 'info',
    text: 'Noted.',
    ...extra
});
const approval = (id: string, decision: string, toolUseId: string | null, turnId: string | null = 't1'): Fields => ({
    ...base(id, turnId),
    kind: 'approval',
    requestId: `request-${id}`,
    toolUseId,
    toolName: 'Bash',
    input: null,
    description: null,
    canAllowAlways: false,
    decision
});
const question = (id: string, state: string, turnId: string | null = 't1'): Fields => ({
    ...base(id, turnId),
    kind: 'question',
    requestId: `request-${id}`,
    questions: [{ id: 'q', header: '', question: 'Which one?', choices: [], multiSelect: false }],
    answers: null,
    state
});
const compaction = (id: string, turnId: string | null = 't1'): Fields => ({ ...base(id, turnId), kind: 'compaction', preTokens: 1200 });

const edit = (id: string, path = 'a.ts', turnId: string | null = 't1', state = 'done'): Fields =>
    tool(id, 'Edit', { file_path: path, old_string: 'x', new_string: 'y' }, state, turnId);
const diff = { files: [{ path: 'a.ts', kind: 'update', added: 1, deleted: 0, diff: '@@\n-a\n+b\n' }], truncated: false };

interface TimelineCase {
    name: string;
    items: Fields[];
    activeTurnId?: string;
    expandedTurns?: string[];
    forkedTurns?: string[];
}

const timelineCases: TimelineCase[] = [];

function add(name: string, items: Fields[], extra: Partial<TimelineCase> = {}): void {
    timelineCases.push({ name, items, ...extra });
}

add('a settled turn folds its work behind the label', [turn('t1'), user('u1'), tool('r1'), tool('r2', 'Read', { file_path: 'b.ts' }), reply('a1')]);
add('the same turn opened', [turn('t1'), user('u1'), tool('r1'), tool('r2'), reply('a1')], { expandedTurns: ['t1'] });
add('a turn of an answer only has no fold', [turn('t1'), user('u1'), reply('a1')]);
add('a turn of only tools folds all of them', [turn('t1'), user('u1'), tool('r1'), tool('b1', 'Bash', { command: 'ls' })]);
add(
    'a run of calls splits where a thought or a note sits between',
    [turn('t1'), user('u1'), tool('r1'), thinking('th1'), tool('r2'), note('n1'), tool('r3'), reply('a1')],
    { expandedTurns: ['t1'] }
);
add('steering splits the conversation inside a turn', [
    turn('t1'),
    user('u1'),
    tool('r1'),
    reply('a1', 't1', 'First.'),
    user('u2'),
    tool('r2'),
    reply('a2', 't1', 'Second.')
]);
add('work after the last answer folds the whole turn', [turn('t1'), user('u1'), reply('a1'), tool('r1')]);
add('an empty reply that no longer streams has no row', [turn('t1'), user('u1'), reply('a0', 't1', ''), tool('r1'), reply('a1')]);
add('a streaming empty reply keeps its row', [turn('t1', 'running'), user('u1'), reply('a1', 't1', '', { streaming: true })], { activeTurnId: 't1' });

for (const decision of ['deny', 'allow', 'allow-always', 'cancelled', 'pending']) {
    add(`a turn ends on a call that was ${decision}`, [
        turn('t1'),
        user('u1'),
        tool('r1'),
        reply('a1', 't1', 'I will do it.'),
        tool('c1', 'Change', {}, 'error'),
        approval('p1', decision, 'c1')
    ]);
}

add('a refused call without a tool use id', [turn('t1'), user('u1'), tool('r1'), reply('a1'), approval('p1', 'deny', null)]);
add('pending questions stay out and answered ones show', [turn('t1'), user('u1'), question('q1', 'pending'), question('q2', 'answered'), reply('a1')]);
add('an image after the closing answer stays with it', [turn('t1'), user('u1'), tool('r1'), reply('a1'), tool('image', 'ImageGeneration', {})]);
add('an image before the answer stands in the fold', [turn('t1'), user('u1'), tool('r1'), tool('image', 'ImageGeneration', {}), tool('r2'), reply('a1')]);
add('a running image', [turn('t1', 'running'), user('u1'), tool('image', 'ImageGeneration', {}, 'running')], { activeTurnId: 't1' });

for (const status of ['running', 'done', 'failed']) {
    for (const background of [false, true]) {
        add(`a ${background ? 'background ' : ''}subagent that is ${status} in a settled turn`, [
            turn('t1'),
            user('u1'),
            tool('r1'),
            agent('sa1', 't1', { status, background }),
            reply('a1')
        ]);
    }
}

add('a subagent after the closing answer', [turn('t1'), user('u1'), tool('r1'), reply('a1'), agent('sa1')]);
add('a turn of a subagent only has no fold', [turn('t1'), agent('sa1')]);
add('a subagent carries its own work and the agents it opened', [
    turn('t1'),
    user('u1'),
    agent('sa1', 't1', { toolUseId: 'spawn' }),
    tool('c1', 'Read', { file_path: 'x' }, 'done', 't1', { parentToolUseId: 'spawn' }),
    reply('c2', 't1', 'inside', { parentToolUseId: 'spawn' }),
    agent('sa2', 't1', { toolUseId: 'inner', parentToolUseId: 'spawn' }),
    tool('c3', 'Bash', { command: 'ls' }, 'done', 't1', { parentToolUseId: 'inner' }),
    reply('a1')
]);
add('a subagent whose parent is unknown has no row of its own place', [
    turn('t1'),
    user('u1'),
    tool('c1', 'Read', {}, 'done', 't1', { parentToolUseId: 'gone' }),
    reply('a1')
]);
add('rows of agents that name each other end at the depth', [
    turn('t1'),
    agent('sa1', 't1', { toolUseId: 'one', parentToolUseId: 'two' }),
    agent('sa2', 't1', { toolUseId: 'two', parentToolUseId: 'one' })
]);

const nested: Fields[] = [turn('t1'), agent('root', 't1', { toolUseId: 'l0' })];

for (let level = 1; level <= 10; level += 1) {
    nested.push(agent(`level-${level}`, 't1', { toolUseId: `l${level}`, parentToolUseId: `l${level - 1}` }));
}

add('agents ten deep stop being drawn at eight', nested);
add('a running workflow stands in a settled turn', [
    turn('t1'),
    user('u1'),
    tool('r1'),
    tool('w1', 'Workflow', {}, 'running', 't1', { workflow: { name: 'flow', phases: [], agents: [] } }),
    reply('a1')
]);
add('a settled workflow folds', [
    turn('t1'),
    user('u1'),
    tool('r1'),
    tool('w1', 'Workflow', {}, 'done', 't1', { workflow: { name: 'flow', phases: [], agents: [] } }),
    reply('a1')
]);
add('a compaction stays out of the fold', [turn('t1'), user('u1'), tool('r1'), compaction('c1'), reply('a1')]);
add('a turn that only compacted shows its divider and no fold', [turn('t1'), compaction('c1')]);
add('a handback call reads as a report', [turn('t1'), user('u1'), tool('r1'), tool('h1', 'SubagentHandback', { message: 'All done.' }), reply('a1')]);
add('a handback without a message stays a call', [turn('t1'), user('u1'), tool('h1', 'SubagentHandback', {}), reply('a1')]);

add('edits make a changed files card', [turn('t1'), user('u1'), edit('e1'), edit('e2', 'b.ts'), reply('a1')]);
add('a failed edit makes no card', [turn('t1'), user('u1'), edit('e1', 'a.ts', 't1', 'error'), reply('a1')]);
add('an edit that is still running makes no card', [turn('t1'), user('u1'), edit('e1', 'a.ts', 't1', 'running'), reply('a1')]);
add('a checkpoint without a diff or edits makes no card', [turn('t1', 'done', { checkpoint: 'tree' }), user('u1'), tool('r1'), reply('a1')]);
add('a checkpoint with edits makes a card', [turn('t1', 'done', { checkpoint: 'tree' }), user('u1'), edit('e1'), reply('a1')]);
add('a checkpoint diff makes a card without edits', [turn('t1', 'done', { checkpoint: 'tree', checkpointDiff: diff }), user('u1'), tool('r1'), reply('a1')]);
add('an empty checkpoint diff hides the edits', [
    turn('t1', 'done', { checkpoint: 'tree', checkpointDiff: { files: [], truncated: false } }),
    user('u1'),
    edit('e1'),
    reply('a1')
]);
add('a diff held back makes a card', [turn('t1', 'done', { checkpointDiff: diff, checkpointDiffRef: { id: 'r', bytes: 1 } }), user('u1'), reply('a1')]);
add('a Write and a MultiEdit are edits too', [
    turn('t1'),
    user('u1'),
    tool('w1', 'Write', { file_path: 'a.ts', content: 'x' }),
    tool('m1', 'MultiEdit', { file_path: 'b.ts', edits: [{ old_string: 'a', new_string: 'b' }] }),
    reply('a1')
]);
add('a patch with changes of its own is an edit', [
    turn('t1'),
    user('u1'),
    tool('p1', 'ApplyPatch', {}, 'done', 't1', { changes: [{ path: 'a.ts', kind: 'update', diff: '@@\n-a\n+b\n' }] }),
    reply('a1')
]);

add('forks hang under a turn', [turn('t1'), user('u1'), reply('a1')], { forkedTurns: ['t1'] });
add('a running turn has no forks', [turn('t1', 'running'), user('u1')], { forkedTurns: ['t1'], activeTurnId: 't1' });

add('an agent turn says why it started', [turn('t1'), user('u1'), reply('a1'), turn('t2', 'done', { origin: 'agent', label: 'Found it' }), reply('a2', 't2')]);
add('an agent turn without a label continues', [turn('t1', 'done', { origin: 'agent' }), reply('a1')]);
add('an agent turn woken by tasks', [turn('t1', 'done', { origin: 'agent', taskIds: ['x', 'y'], label: 'Build, Test' }), reply('a1')]);
add('an agent turn woken by tasks without a label', [turn('t1', 'done', { origin: 'agent', taskIds: ['x'] }), reply('a1')]);
add('an agent turn woken by a subagent', [turn('t1', 'done', { origin: 'agent', label: 'Report', taskToolUseId: 'use-sa1' }), reply('a1')]);
add('an agent turn woken by a background command', [turn('t1', 'done', { origin: 'agent', label: 'Dev server' }), reply('a1')]);
add('an agent turn woken by messages with the messages above it', [
    note('m1', null, { message: { from: 'node-a', title: 'A', text: 'hi' } }),
    note('m2', null, { message: { from: 'node-b', title: 'B', text: 'hey' } }),
    turn('t1', 'done', { origin: 'agent', messageFrom: ['node-a', 'node-b'] }),
    reply('a1')
]);
add('an agent turn woken by messages that are not all above it', [
    note('m1', null, { message: { from: 'node-a', title: 'A', text: 'hi' } }),
    turn('t1', 'done', { origin: 'agent', messageFrom: ['node-a', 'node-b'], label: 'A, B' }),
    reply('a1')
]);
add('a message note outside any turn', [note('m1', null, { message: { from: 'node-a', title: 'A', text: 'hi' } }), user('u1', null), reply('a1', null)]);

const selection = (model: string, effort?: string): Fields => ({ model, options: effort === undefined ? {} : { effort } });

add('a selection switch stands above the turn that ran on it', [
    turn('t1', 'done', { selection: selection('opus', 'low') }),
    user('u1', 't1'),
    turn('t2', 'done', { selection: selection('opus', 'low') }),
    user('u2', 't2'),
    turn('t3', 'done', { selection: selection('sonnet', 'low') }),
    user('u3', 't3'),
    turn('t4', 'done'),
    user('u4', 't4'),
    turn('t5', 'done', { selection: selection('sonnet', 'high') }),
    user('u5', 't5')
]);

add('a stopped turn by the person', [turn('t1', 'aborted'), user('u1'), tool('r1'), reply('a1')]);
add('a stopped turn by the machine', [
    turn('t1', 'aborted'),
    user('u1'),
    tool('r1'),
    note('n1', 't1', { level: 'warning', text: notResumedNote('the machine restarted') })
]);
add('a stopped turn by the machine keeps its last answer', [
    turn('t1', 'aborted'),
    user('u1'),
    reply('a1', 't1', 'Partial.'),
    tool('r1'),
    note('n1', 't1', { level: 'warning', text: notResumedNote('gone') })
]);
add('a stopped turn with an ordinary warning note', [
    turn('t1', 'aborted'),
    user('u1'),
    tool('r1'),
    note('n1', 't1', { level: 'warning', text: 'Something else.' })
]);
add('a failed turn', [turn('t1', 'error'), user('u1'), tool('r1')]);
add('a turn that took an hour', [turn('t1', 'done', { endedAt: 1000 + 3_725_000, createdAt: 1000 }), user('u1'), tool('r1'), reply('a1')]);
add('a turn that took a moment', [turn('t1', 'done', { endedAt: 1100, createdAt: 1000 }), user('u1'), tool('r1'), reply('a1')]);

add('items without a turn show as they are', [user('u1', null), tool('r1', 'Read', {}, 'done', null), reply('a1', null), note('n1', null)]);
add('a subagent without a turn', [agent('sa1', null), reply('a1', null)]);
add('notes around the work', [turn('t1'), note('n1'), user('u1'), note('n2'), tool('r1'), note('n3'), reply('a1'), note('n4')]);
add('a thought is a row of its own in a settled turn', [turn('t1'), user('u1'), thinking('th1'), tool('r1'), thinking('th2'), reply('a1')], {
    expandedTurns: ['t1']
});

add(
    'a running turn with calls',
    [
        turn('t1', 'running'),
        user('u1'),
        tool('b1', 'Bash', { command: 'ls' }),
        tool('b2', 'Bash', { command: 'pwd' }, 'running'),
        tool('b3', 'Bash', { command: 'who' })
    ],
    { activeTurnId: 't1' }
);
add('a running turn streaming an answer', [turn('t1', 'running'), user('u1'), tool('r1'), reply('a1', 't1', 'Working', { streaming: true })], {
    activeTurnId: 't1'
});
add(
    'a running turn with a thought over a running image',
    [turn('t1', 'running'), user('u1'), thinking('th1'), tool('r1'), tool('image', 'ImageGeneration', {}, 'running')],
    { activeTurnId: 't1' }
);
add(
    'a running turn with a thought and a running image right after it',
    [turn('t1', 'running'), user('u1'), thinking('th1'), tool('image', 'ImageGeneration', {}, 'running')],
    { activeTurnId: 't1' }
);
add(
    'a newer thought came after the image',
    [turn('t1', 'running'), user('u1'), thinking('th1'), tool('r1'), tool('image', 'ImageGeneration', {}, 'running'), thinking('th2')],
    { activeTurnId: 't1' }
);
add('an empty thought stays put', [turn('t1', 'running'), user('u1'), thinking('th1', 't1', ''), tool('r1'), tool('image', 'ImageGeneration', {}, 'running')], {
    activeTurnId: 't1'
});
add('a thought with only a subagent call after it', [turn('t1', 'running'), user('u1'), thinking('th1'), agent('sa1', 't1', { status: 'running' })], {
    activeTurnId: 't1'
});
add(
    'a running turn with a running workflow',
    [turn('t1', 'running'), user('u1'), thinking('th1'), tool('w1', 'Workflow', {}, 'running', 't1', { workflow: { name: 'flow', phases: [], agents: [] } })],
    { activeTurnId: 't1' }
);
add(
    'an earlier turn and a running one',
    [turn('t1'), user('u1'), tool('r1'), reply('a1'), turn('t2', 'running'), user('u2'), tool('r2', 'Read', {}, 'running', 't2')],
    { activeTurnId: 't2' }
);
add('a running turn with a pending approval', [turn('t1', 'running'), user('u1'), approval('p1', 'pending', null), approval('p2', 'allow', null)], {
    activeTurnId: 't1'
});

// Seeded threads, to reach orders nobody wrote down.
const random = seeded(4242);
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
let serial = 0;

function randomItem(turnId: string, depth: number): Fields[] {
    serial += 1;
    const id = `x${serial}`;

    switch (
        pick(['read', 'read', 'bash', 'edit', 'reply', 'reply', 'think', 'note', 'agent', 'image', 'workflow', 'compaction', 'user', 'write', 'grep', 'web'])
    ) {
        case 'read':
            return [tool(id, 'Read', { file_path: `${id}.ts` }, 'done', turnId)];
        case 'bash':
            return [tool(id, 'Bash', { command: `echo ${id}` }, pick(['done', 'done', 'error']), turnId)];
        case 'edit':
            return [edit(id, pick(['a.ts', 'b.ts', `${id}.ts`]), turnId, pick(['done', 'done', 'error']))];
        case 'write':
            return [tool(id, 'Write', { file_path: pick(['a.ts', `${id}.ts`]), content: 'x' }, pick(['done', 'error']), turnId)];
        case 'grep':
            return [tool(id, pick(['Grep', 'Glob', 'Grep']), { pattern: 'x' }, 'done', turnId)];
        case 'web':
            return [tool(id, pick(['WebFetch', 'WebSearch', 'Skill', 'TodoWrite', 'Task', 'mcp__srv__call']), { url: 'u', query: 'q' }, 'done', turnId)];
        case 'reply':
            return [reply(id, turnId, pick(['Done.', 'Here you go.', '']))];
        case 'think':
            return [thinking(id, turnId)];
        case 'note':
            return [note(id, turnId, pick([{}, { level: 'warning' }]))];
        case 'agent':
            return [
                agent(id, turnId, { status: pick(['running', 'done', 'failed']), background: random() < 0.5, toolUseId: `use-${id}` }),
                ...(depth < 2 && random() < 0.5 ? [tool(`${id}-c`, 'Read', {}, 'done', turnId, { parentToolUseId: `use-${id}` })] : [])
            ];
        case 'image':
            return [tool(id, 'ImageGeneration', {}, pick(['done', 'running']), turnId)];
        case 'workflow':
            return [tool(id, 'Workflow', {}, pick(['done', 'running']), turnId, { workflow: { name: 'flow', phases: [], agents: [] } })];
        case 'compaction':
            return [compaction(id, turnId)];
        default:
            return [user(id, turnId)];
    }
}

for (let index = 0; index < 120; index += 1) {
    const items: Fields[] = [];
    const turns = Math.floor(random() * 3) + 1;
    let active: string | undefined;

    for (let position = 0; position < turns; position += 1) {
        const turnId = `rt${position}`;
        const running = position === turns - 1 && random() < 0.35;
        const state = running ? 'running' : pick(['done', 'done', 'done', 'aborted', 'error'] as const);

        if (running) {
            active = turnId;
        }

        items.push(
            turn(turnId, state, {
                ...(random() < 0.2 ? { origin: 'agent', label: pick(['Found', undefined]) } : {}),
                ...(random() < 0.2 ? { checkpoint: 'tree' } : {}),
                ...(random() < 0.15 ? { checkpointDiff: random() < 0.5 ? diff : { files: [], truncated: false } } : {})
            })
        );

        if (random() < 0.8) {
            items.push(user(`u-${turnId}`, turnId));
        }

        for (let count = Math.floor(random() * 7); count > 0; count -= 1) {
            items.push(...randomItem(turnId, 0));
        }

        if (!running && random() < 0.7) {
            items.push(reply(`end-${turnId}`, turnId));
        }
    }

    add(`seeded thread ${index}`, items, {
        ...(active === undefined ? {} : { activeTurnId: active }),
        expandedTurns: random() < 0.3 ? ['rt0'] : [],
        forkedTurns: random() < 0.3 ? ['rt0'] : []
    });
}

function projectRow(row: TimelineRow): Record<string, unknown> {
    const swiftId = row.kind === 'work-group' ? row.id.replace(/^group-/, 'tools-') : row.id;
    const branch = (entry: { item: { id: string }; children: { id: string }[]; nested: unknown[] }): unknown => ({
        id: entry.item.id,
        children: entry.children.map((child) => child.id),
        nested: (entry.nested as (typeof entry)[]).map(branch)
    });

    switch (row.kind) {
        case 'work-group':
            return { kind: row.kind, id: swiftId, tools: (row.tools as { id: string }[]).map((entry) => entry.id), summary: row.summary };
        case 'turn-fold':
            return { kind: row.kind, id: swiftId, label: row.label, work: row.work };
        case 'turn-start':
            return { kind: row.kind, id: swiftId, label: row.label };
        case 'subagent':
            return { kind: row.kind, id: swiftId, ...(branch(row as never) as object) };
        case 'changed-files':
            return { kind: row.kind, id: swiftId, tools: (row.tools as { id: string }[]).map((entry) => entry.id) };
        default:
            return { kind: row.kind, id: swiftId };
    }
}

const timeline = timelineCases.map((entry) => {
    const items = entry.items.map((item) => ChatItemSchema.parse(item));
    const rows = derive.deriveTimelineRows(items, {
        expandedGroups: new Set(),
        expandedTurns: new Set(entry.expandedTurns ?? []),
        expandedSubagents: new Set(),
        activeTurnId: entry.activeTurnId ?? null,
        forkedTurns: new Set(entry.forkedTurns ?? [])
    });

    return {
        name: entry.name,
        items,
        activeTurnId: entry.activeTurnId ?? null,
        expandedTurns: entry.expandedTurns ?? [],
        forkedTurns: entry.forkedTurns ?? [],
        rows: rows.map(projectRow)
    };
});

// The tool table and the sentences of a run of calls.
const catalogModule = await adecore<{
    TOOL_CATALOG: Record<
        string,
        { icon: { displayName?: string }; summary: string[]; grouped: boolean; changesFiles: boolean; readsImage: boolean; shell: boolean }
    >;
}>(`${chatLogic}/tool-catalog.js`);
const toolsModule = await adecore<{
    toolSummary(name: string, input: unknown): string;
    toolSummaryIsPath(name: string, input: unknown): boolean;
    isFileChange(name: string): boolean;
}>(`${chatLogic}/tools.js`);
const timelineLogic = await adecore<{ summarizeTurn(tools: ChatItem[]): string[]; summarizeGroup(tools: ChatItem[]): string }>(`${chatLogic}/timeline.js`);
const iconModule = await adecore<{ toolIcon(name: string): { props: { icon: { displayName?: string } } } }>(`${root}/dist/chat/ui/icons.js`);

const kebab = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

// The wire name of every tool the catalog knows, and the names it does not.
const catalogNames = Object.keys(catalogModule.TOOL_CATALOG);
const otherNames = ['ImageGeneration', 'Change', 'mcp__server__tool', 'mcp__ruimte__view_list', 'Unknown', ''];

const toolTable = [...catalogNames, ...otherNames].map((name) => {
    const entry = catalogModule.TOOL_CATALOG[name];
    const icon = (iconModule.toolIcon(name) as { props: { icon: { displayName?: string } } }).props.icon.displayName ?? '';

    return {
        name,
        icon: kebab(icon),
        known: entry !== undefined,
        summary: entry?.summary ?? null,
        grouped: entry?.grouped ?? false,
        changesFiles: toolsModule.isFileChange(name),
        shell: entry?.shell ?? false
    };
});

const summaryInputs: [string, unknown][] = [
    ['Read', { file_path: 'a/b.ts' }],
    ['Read', {}],
    ['Read', { file_path: 3 }],
    ['Read', { notebook_path: 'n.ipynb' }],
    ['NotebookRead', { notebook_path: 'n.ipynb' }],
    ['NotebookRead', { file_path: 'f', notebook_path: 'n.ipynb' }],
    ['NotebookEdit', { notebook_path: 'n.ipynb' }],
    ['NotebookEdit', { file_path: 'f.ipynb', notebook_path: 'n.ipynb' }],
    ['Edit', { file_path: 'e.ts', old_string: 'x' }],
    ['Write', { file_path: 'w.ts', content: 'c' }],
    ['MultiEdit', { file_path: 'm.ts', edits: [] }],
    ['ApplyPatch', { summary: 'Touched 2 files' }],
    ['ApplyPatch', { file_path: 'p.ts' }],
    ['Bash', { description: 'List', command: 'ls' }],
    ['Bash', { command: 'ls' }],
    ['Bash', { description: 3, command: 'ls' }],
    ['Bash', { command: ['ls'] }],
    ['Grep', { pattern: 'x', path: 'y' }],
    ['Glob', { pattern: '*.ts' }],
    ['WebFetch', { url: 'https://a', query: 'q' }],
    ['WebFetch', { query: 'q' }],
    ['WebSearch', { query: 'q' }],
    ['Task', { description: 'Look', prompt: 'p' }],
    ['Agent', { description: 'Look' }],
    ['Skill', { skill: 'review' }],
    ['TodoWrite', { todos: [] }],
    ['TodoWrite', { summary: 'x' }],
    ['Workflow', { script: 'x' }],
    ['mcp__server__tool', { first: 3, second: 'second', third: 'third' }],
    ['mcp__server__tool', { first: 3 }],
    ['Unknown', { a: 'a', b: 'b' }],
    ['Unknown', {}],
    ['Unknown', null],
    ['Unknown', 'text'],
    ['Read', null],
    ['Read', 'text'],
    ['Bash', []]
];

const toolSummaries = summaryInputs.map(([name, input]) => ({
    name,
    input,
    summary: toolsModule.toolSummary(name, input),
    isPath: toolsModule.toolSummaryIsPath(name, input)
}));

// Runs of calls, as the thread groups them and as a folded turn counts them.
const groupNames = [...catalogNames, 'ImageGeneration', 'Change', 'mcp__server__tool', 'Unknown'];
const groupRuns: ChatItem[][] = [];
let groupId = 0;

const groupTool = (name: string, state = 'done', input: unknown = { file_path: `f${groupId}.ts` }): ChatItem => {
    groupId += 1;

    return ChatItemSchema.parse(tool(`g${groupId}`, name, input, state, 't1'));
};

for (const name of groupNames) {
    for (const count of [1, 2, 3]) {
        groupRuns.push(Array.from({ length: count }, () => groupTool(name)));
    }

    groupRuns.push([groupTool(name, 'error'), groupTool(name)]);
}

for (const first of groupNames) {
    for (const second of groupNames) {
        groupRuns.push([groupTool(first), groupTool(second)]);
    }
}

groupRuns.push(
    [groupTool('Edit', 'done', { file_path: 'a.ts' }), groupTool('Edit', 'done', { file_path: 'a.ts' }), groupTool('Edit', 'done', { file_path: 'b.ts' })],
    [groupTool('Edit', 'error', { file_path: 'a.ts' }), groupTool('Edit', 'error', { file_path: 'b.ts' })],
    [groupTool('Edit', 'error', { file_path: 'a.ts' }), groupTool('Write', 'done', { file_path: 'b.ts' })],
    [groupTool('Write', 'done', { file_path: 'a.ts' }), groupTool('Edit', 'done', { file_path: 'a.ts' }), groupTool('Edit', 'done', {})],
    [groupTool('Write', 'error', { file_path: 'a.ts' }), groupTool('Write', 'done', { file_path: 'a.ts' })],
    [groupTool('ApplyPatch', 'done', {}), groupTool('Edit', 'done', { file_path: 'a.ts' })],
    [
        groupTool('Read'),
        groupTool('Edit', 'done', { file_path: 'a.ts' }),
        groupTool('Bash', 'done', { command: 'ls' }),
        groupTool('Read'),
        groupTool('Mystery')
    ],
    [groupTool('Read'), groupTool('Read'), groupTool('Grep', 'done', { pattern: 'x' }), groupTool('Zed'), groupTool('Zed')],
    [groupTool('NotebookEdit', 'done', { notebook_path: 'n' }), groupTool('NotebookEdit', 'done', { notebook_path: 'm' })],
    [groupTool('Task', 'done', { description: 'a' }), groupTool('Agent', 'done', { description: 'b' })]
);

const groupSeed = seeded(99);

for (let index = 0; index < 120; index += 1) {
    const length = Math.floor(groupSeed() * 8) + 1;
    groupRuns.push(
        Array.from({ length }, () =>
            groupTool(
                groupNames[Math.floor(groupSeed() * groupNames.length)]!,
                groupSeed() < 0.2 ? 'error' : 'done',
                groupSeed() < 0.5 ? { file_path: `f${Math.floor(groupSeed() * 3)}.ts` } : {}
            )
        )
    );
}

const sentences = groupRuns.map((run) => ({
    tools: run.map((entry) => {
        const { id, name, state, input } = entry as ChatItem & { name: string; state: string; input: unknown };
        return { id, name, state, input };
    }),
    group: timelineLogic.summarizeGroup(run),
    turn: timelineLogic.summarizeTurn(run)
}));

// The files a call changes.
const editInputs: [string, unknown][] = [
    ['Edit', { file_path: 'a.ts', old_string: 'one\ntwo', new_string: 'three' }],
    ['Edit', { file_path: 'a.ts', old_string: '', new_string: 'added\nlines\n' }],
    ['Edit', { file_path: 'a.ts', old_string: 'gone', new_string: '' }],
    ['Edit', { file_path: 'a.ts' }],
    ['Edit', { file_path: 'a.ts', old_string: 3, new_string: null }],
    ['Edit', { file_path: '', old_string: 'a', new_string: 'b' }],
    ['Edit', { old_string: 'a', new_string: 'b' }],
    ['Edit', { file_path: 4, old_string: 'a', new_string: 'b' }],
    ['Edit', null],
    ['Edit', 'text'],
    ['Edit', []],
    ['Write', { file_path: 'w.ts', content: 'line one\nline two\n' }],
    ['Write', { file_path: 'w.ts', content: '' }],
    ['Write', { file_path: 'w.ts' }],
    ['Write', { file_path: 'w.ts', content: 7 }],
    ['Write', { content: 'x' }],
    [
        'MultiEdit',
        {
            file_path: 'm.ts',
            edits: [
                { old_string: 'a', new_string: 'b' },
                { old_string: 'c\nd', new_string: 'e' }
            ]
        }
    ],
    ['MultiEdit', { file_path: 'm.ts', edits: [] }],
    ['MultiEdit', { file_path: 'm.ts', edits: [{ old_string: 'a', new_string: 'b' }, 'text', null, 4, { new_string: 'only' }] }],
    ['MultiEdit', { file_path: 'm.ts' }],
    ['MultiEdit', { file_path: 'm.ts', edits: 'no' }],
    ['MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }] }],
    ['NotebookEdit', { file_path: 'n.ipynb', new_source: 'x' }],
    ['ApplyPatch', { file_path: 'p.ts' }],
    ['Bash', { file_path: 'b.sh', command: 'ls' }],
    ['Read', { file_path: 'r.ts' }],
    ['Unknown', { file_path: 'u.ts', old_string: 'a', new_string: 'b' }]
];

const fileEdits = editInputs.map(([name, input]) => ({ name, input, edit: toolFileEdit(name, input) }));

// The simple commands of a shell line.
const { shellCommands } = await adecore<{
    shellCommands(source: string): { words: { text: string }[]; program: { index: number; name: string } | null; heredocs: unknown[]; redirects: unknown[] }[];
}>(`${chatLogic}/embedded-code.js`);

const shellLines = [
    '',
    '   ',
    'ls',
    'ls -la /tmp',
    'FOO=1 /opt/bin/tool run "a b" --x 2>&1 | grep -E \'x\' && sleep 3',
    'A=1 B=2',
    'A=1 B=2 make test',
    'sudo -u root apt install x',
    'env FOO=bar node script.js',
    'exec -a name sh',
    'nohup ./run.sh &',
    'time -p make',
    'command -v node',
    'nice -n 5 sleep 1',
    'uv run pytest -x',
    'poetry run python -m app',
    'pipenv run flask run',
    'uv sync',
    'uv run',
    'poetry',
    'cd /tmp && ls; pwd || echo no',
    'echo one; echo two\necho three',
    'a | b | c',
    '(cd sub && make) && echo ok',
    'echo "quoted ; not a split" && echo \'single | pipe\'',
    'echo "esc \\" quote" next',
    "echo 'it'\"'\"'s'",
    'echo a\\ b c',
    'echo $(date) `uname`',
    'echo ${HOME}/x',
    'cat file # comment ; ls',
    '# only a comment',
    'echo a \\\n  b',
    'cat > out.txt <<EOF\nhello\nEOF\nls',
    "cat <<'EOF' > out.sh\n$VAR stays\nEOF",
    'cat <<-EOF\n\tindented\n\tEOF\necho after',
    'python3 - <<PY\nprint(1)\nPY',
    'cat <<A <<B\nfirst\nA\nsecond\nB',
    'tool <<EOF\nunterminated',
    'cat <<< "here string" | wc',
    'grep x < in.txt > out.txt 2> err.txt',
    'cmd 2>&1 >/dev/null',
    'cmd &> all.log',
    'cmd >| forced.txt',
    'echo a >> log && echo b',
    'ls;;ls',
    'ls &&',
    '&& ls',
    '| ls',
    'a & b &',
    "echo 'unterminated",
    'echo "unterminated',
    'echo a\tb\rc',
    'git commit -m "feat: x" -m "body\nmore"',
    "bash -lc 'cd x && ls'",
    "node -e 'console.log(1)'",
    '/usr/local/bin/node -v',
    './local/bin/run',
    'FOO=1 BAR=2',
    'sudo',
    'sudo -',
    'env',
    'echo 日本語 \u{1f600} café',
    'echo "日本" | wc',
    'x=$(echo "a b") y',
    'echo {a,b} * ?',
    'if true; then echo yes; fi',
    'for i in 1 2; do echo $i; done',
    'while read l; do echo "$l"; done < file',
    'case x in a) echo a;; esac'
];

const shells = shellLines.map((source) => ({
    source,
    commands: shellCommands(source).map((command) => ({
        words: command.words.map((word) => word.text),
        program: command.program,
        heredocs: command.heredocs.length
    }))
}));

// Sub-agents.
const { summaryWordOf, badgeCountOf, progressOf, statusWordOf, subagentTitle } = await adecore<{
    summaryWordOf(words: string[]): string;
    badgeCountOf(words: string[]): number;
    progressOf(states: string[]): { done: number; total: number; waiting: number; active: number };
    statusWordOf(item: unknown, task: unknown): string;
    subagentTitle(item: unknown): string;
}>(`${root}/dist/chat/subagent-list.js`);

const statusWords = ['running', 'paused', 'done', 'failed', 'cancelled'];
const rowStates = ['running', 'waiting', 'paused', 'done', 'failed', 'cancelled'];

function sequences(words: string[], longest: number): string[][] {
    const found: string[][] = [[]];

    for (let length = 1; length <= longest; length += 1) {
        let layer: string[][] = [[]];

        for (let position = 0; position < length; position += 1) {
            layer = layer.flatMap((prefix) => words.map((word) => [...prefix, word]));
        }

        found.push(...layer);
    }

    return found;
}

const subagentWords = sequences(statusWords, 3).map((words) => ({ words, summary: summaryWordOf(words), badge: badgeCountOf(words) }));
const subagentProgress = sequences(rowStates, 3).map((states) => ({ states, ...progressOf(states) }));

const taskRows = [
    { id: 'task-abc', origin: 'ruimte' },
    { id: 'task-abc', origin: 'native' },
    { id: 'task-abc' },
    { id: 'task-', origin: 'ruimte' },
    { id: 'abc', origin: 'ruimte' },
    { id: 'task-task-x', origin: 'ruimte' },
    { id: 'Task-abc', origin: 'ruimte' },
    { id: 'toolu_1' }
].map((row) => ({ row, taskId: taskIdOfRow(row) }));

const taskSettings: unknown[] = [
    null,
    { status: 'open' },
    { status: 'open', paused: { kind: 'usage', until: 5 } },
    { status: 'open', paused: { kind: 'usage' } },
    { status: 'cancelled' },
    { status: 'done' },
    { status: 'cancelled', paused: { kind: 'usage' } }
];

const subagentStatuses = (['running', 'done', 'failed'] as const).flatMap((status) =>
    taskSettings.map((task) => ({ item: ChatItemSchema.parse(agent('sa', 't1', { status })), task, word: statusWordOf({ status }, task) }))
);

const titles = [
    { description: 'Look', summary: 'S', subagentType: 'T' },
    { description: '', summary: 'S', subagentType: 'T' },
    { description: '', summary: null, subagentType: 'T' },
    { description: '', summary: '', subagentType: null },
    { description: '', summary: null, subagentType: null }
].map((fields) => ({ item: ChatItemSchema.parse(agent('sa', 't1', fields)), title: subagentTitle(fields) }));

const flyoutThreads: Fields[][] = [];
const flyoutRandom = seeded(31);

for (let index = 0; index < 80; index += 1) {
    const items: Fields[] = [];

    for (let position = 0; position < Math.floor(flyoutRandom() * 7) + 1; position += 1) {
        const turnId = `ft${Math.floor(flyoutRandom() * 3)}`;
        const id = `f${position}`;
        const roll = flyoutRandom();

        if (roll < 0.35) {
            items.push(user(id, turnId));
        } else if (roll < 0.9) {
            items.push(
                agent(id, turnId, {
                    status: ['running', 'done', 'failed'][Math.floor(flyoutRandom() * 3)],
                    finishedAt: flyoutRandom() < 0.3 ? null : 1000 + Math.floor(flyoutRandom() * 400)
                })
            );
        } else {
            items.push(reply(id, turnId));
        }
    }

    flyoutThreads.push(items);
}

const flyouts = flyoutThreads.map((items) => {
    const parsed = items.map((item) => ChatItemSchema.parse(item));

    return { items: parsed, active: activeSubagents(parsed).map((entry) => entry.id) };
});

// Workflows.
const { workflowPhases, workflowAgentTime, workflowAgentPreview, workflowCounts, workflowDescription } = await adecore<{
    workflowPhases(workflow: unknown, running: boolean): { key: string; title: string | null; agents: { agent: { index: number }; state: string }[] }[];
    workflowAgentTime(view: unknown): string | null;
    workflowAgentPreview(view: unknown): { tool: string | null; text: string | null };
    workflowCounts(phases: unknown): Record<string, number>;
    workflowDescription(input: unknown): string | null;
}>(`${chatLogic}/workflow.js`);

const workflowAgent = (index: number, status: string, extra: Fields = {}): Fields => ({
    index,
    label: `agent ${index}`,
    phaseIndex: null,
    agentId: `id-${index}`,
    status,
    startedAt: 1000 + index,
    durationMs: 1500,
    lastTool: null,
    ...extra
});

const workflowRandom = seeded(5);
const workflowCases: Fields[] = [
    { name: 'flow', phases: [], agents: [] },
    {
        name: null,
        phases: [
            { index: 0, title: 'Plan' },
            { index: 1, title: 'Build' }
        ],
        agents: []
    },
    {
        name: 'flow',
        phases: [
            { index: 0, title: 'Plan' },
            { index: 1, title: 'Build' }
        ],
        agents: [
            workflowAgent(0, 'done', { phaseIndex: 0, resultPreview: '# Result heading\n\nBody' }),
            workflowAgent(1, 'running', { phaseIndex: 1, lastTool: 'Bash', lastToolSummary: 'ls -la', promptPreview: 'Do it' }),
            workflowAgent(2, 'running', { phaseIndex: 1, startedAt: null, promptPreview: '## Ask\nmore' }),
            workflowAgent(3, 'failed', { phaseIndex: 0, error: '  \n## Broke  \nhard', resultPreview: 'kept', durationMs: null }),
            workflowAgent(4, 'running', { phaseIndex: null, lastTool: null, promptPreview: '   \n\n  first real line  ' }),
            workflowAgent(5, 'done', { phaseIndex: 9 })
        ]
    }
];

for (let index = 0; index < 40; index += 1) {
    const agents = Array.from({ length: Math.floor(workflowRandom() * 6) }, (_, position) =>
        workflowAgent(position, ['running', 'done', 'failed'][Math.floor(workflowRandom() * 3)]!, {
            phaseIndex: workflowRandom() < 0.2 ? null : Math.floor(workflowRandom() * 3),
            startedAt: workflowRandom() < 0.3 ? null : 1000 + position,
            durationMs: workflowRandom() < 0.3 ? null : Math.floor(workflowRandom() * 4_000_000),
            lastTool: workflowRandom() < 0.5 ? 'Read' : null,
            ...(workflowRandom() < 0.5 ? { lastToolSummary: '# a\nb' } : {}),
            ...(workflowRandom() < 0.5 ? { promptPreview: '\n# asked' } : {}),
            ...(workflowRandom() < 0.5 ? { resultPreview: 'answered\nmore' } : {}),
            ...(workflowRandom() < 0.3 ? { error: 'oops' } : {})
        })
    );

    workflowCases.push({
        name: 'flow',
        phases: [0, 1, 2].filter(() => workflowRandom() < 0.7).map((phase) => ({ index: phase, title: `Phase ${phase}` })),
        agents
    });
}

const workflows = workflowCases.flatMap((workflow) =>
    [true, false].map((running) => {
        const phases = workflowPhases(workflow, running);

        return {
            workflow,
            running,
            phases: phases.map((phase) => ({
                key: phase.key,
                title: phase.title,
                agents: phase.agents.map((view) => ({
                    index: view.agent.index,
                    state: view.state,
                    time: workflowAgentTime(view),
                    preview: workflowAgentPreview(view)
                }))
            })),
            counts: workflowCounts(phases)
        };
    })
);

const workflowInputs: unknown[] = [
    { script: "export const meta = { description: 'Fix the build', name: 'x' }\nrun()" },
    { script: 'export const meta = { name: "x", description: "Say \\"hi\\" there" }' },
    { script: 'export const meta = { description: `Back\\ntick` }' },
    { script: "export const meta = { nested: { description: 'inner' } }" },
    { script: "export const meta = { note: 'a } brace', description: 'after brace' }" },
    { script: "export const meta = { description: '   ' }" },
    { script: "export const meta = { description: '  padded  ' }" },
    { script: "const meta = { description: 'not exported' }" },
    { script: 'export const meta = { description: "unterminated' },
    { script: 'export  const   meta={description:"tight"}' },
    { script: "export const meta = { name: 'x' }" },
    { script: '' },
    { saved: 'name' },
    { script: 3 },
    null,
    'text'
];

const workflowDescriptions = workflowInputs.map((input) => ({ input, description: workflowDescription(input) }));

await writeGenerated(
    new Map([
        [
            destination,
            compactFixture({
                timeline,
                toolTable,
                toolSummaries,
                sentences,
                fileEdits,
                shells,
                subagentWords,
                subagentProgress,
                taskRows,
                subagentStatuses,
                titles,
                flyouts,
                workflows,
                workflowDescriptions
            })
        ]
    ]),
    `${timeline.length} chat timeline cases and ${sentences.length} runs of calls`
);
