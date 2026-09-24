import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { heapStats } from 'bun:jsc';
import type { ProjectContent } from '@ruimte/contracts';
import { ChatStore } from '../src/chat/chat-store.ts';
import { ManualClock } from '../src/outbox/manual-clock.ts';
import { ProjectStore } from '../src/projects/project-store.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../src/tasks/test-daemon.ts';

/*
 * The daemon's memory over a long session: a lead with a team of five chat children that keep getting
 * new work, each task a tool call with a sizeable output, on the fake CLI in this process. Samples after
 * a forced collection every round, prints every `--every`th and the growth per round, then clears every
 * thread to show what the rounds left outside them (`--types` adds the object counts that changed).
 * `--rounds`, `--warmup` and `--output` (bytes of tool output per task) override the defaults.
 */
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        rounds: { type: 'string', default: '100' },
        warmup: { type: 'string', default: '5' },
        output: { type: 'string', default: '65536' },
        every: { type: 'string', default: '10' },
        types: { type: 'boolean', default: false }
    },
    strict: true
});
const rounds = Number(values.rounds);
const warmup = Number(values.warmup);
const outputBytes = Number(values.output);
const every = Number(values.every);

const MIB = 1024 * 1024;
const LEAD = 'chat-lead';
const ROLES = ['Lexer', 'Parser', 'Checker', 'Emitter', 'Docs'];

const content = (): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [{ id: LEAD, kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' }],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
});

// Counted on the prototype, since the harness builds the daemon's own store.
let written = 0;
let writes = 0;
const write = ChatStore.prototype.write;
ChatStore.prototype.write = async function (this: ChatStore, ...args: Parameters<ChatStore['write']>): Promise<number> {
    const bytes = await write.apply(this, args);
    written += bytes;
    writes += 1;
    return bytes;
};

const root = await mkdtemp(join(tmpdir(), 'ruimte-memory-'));
const home = join(root, 'home');
const folder = join(root, 'repo');
await mkdir(folder, { recursive: true });
const store = new ProjectStore(home);
const opened = await store.openProject({ folder });
await store.save(opened.summary.projectId, opened.document.rev, content());
store.release(opened.summary.projectId);
const clock = new ManualClock();
const daemon: TestDaemon = await bootTestDaemon({ home, store, clock });
daemon.worker.start();

const lead = daemon.chats;
await lead.create({ chatId: LEAD, provider: 'claude', cwd: folder });
await lead.send(LEAD, 'plan the work');

const idle = (chatId: string): boolean => daemon.chats.get(chatId)?.info.activeTurnId === null;

/* Every task of the round settled, its wake delivered, and every chat idle with nothing owed. */
const roundDone = async (taskIds: readonly string[], children: readonly string[]): Promise<void> => {
    const stuck = setTimeout(() => {
        const tasks = taskIds.map((taskId) => daemon.tasks.get(taskId)).map((entry) => `${entry?.id} ${entry?.status} ${entry?.wake}`);
        const chats = [LEAD, ...children].map((chatId) => `${chatId} ${daemon.chats.get(chatId)?.info.status} ${daemon.chats.get(chatId)?.info.activeTurnId}`);
        const owed = daemon.outbox.list().map((entry) => entry.kind);
        console.error(`a round did not settle in 30 s\n${tasks.join('\n')}\n${chats.join('\n')}\noutbox ${owed.join(', ')}`);
        process.exit(1);
    }, 30_000);
    await daemon.until(() => taskIds.every((taskId) => daemon.tasks.get(taskId)?.wake === 'sent') && idle(LEAD) && children.every(idle));
    // Taking an entry off the outbox fires no event, so what is still owed is waited on here.
    while (daemon.outbox.list().length > 0) {
        await daemon.worker.settled();
        await Bun.sleep(1);
    }
    clearTimeout(stuck);
};

const task = `output:${outputBytes}`;
const roles = ROLES.map((title) => ({ title, prompt: task, provider: 'claude' }));
const lines = await runVerb(daemon, LEAD, 'team', ['--label', 'Crew', '--task', '--roles', JSON.stringify(roles)]);
const team = lines.slice(1, -1).map((line) => {
    const fields = line.split('\t');
    return { childId: fields[0]!, taskId: fields[6]! };
});
if (team.length !== ROLES.length) {
    throw new Error(`the team verb answered ${lines.join(' | ')}`);
}
const children = team.map((member) => member.childId);
await roundDone(
    team.map((member) => member.taskId),
    children
);

const round = async (): Promise<void> => {
    const taskIds: string[] = [];
    for (const childId of children) {
        const [line = ''] = await runVerb(daemon, LEAD, 'task', ['new', childId, '--prompt', task, '--title', 'Next part']);
        const taskId = line.split('\t')[1];
        if (!line.startsWith('task\t') || taskId === undefined) {
            throw new Error(`task new answered ${line}`);
        }
        taskIds.push(taskId);
    }
    await roundDone(taskIds, children);
};

interface Sample {
    round: number;
    heapUsed: number;
    rss: number;
    objects: number;
}

const sample = (at: number): Sample => {
    Bun.gc(true);
    const memory = process.memoryUsage();
    return { round: at, heapUsed: memory.heapUsed, rss: memory.rss, objects: heapStats().objectCount };
};

const chats = (): string[] => [LEAD, ...children];

const report = (entry: Sample): void => {
    const threads = chats().map((chatId) => daemon.chats.get(chatId)?.thread.list() ?? []);
    console.log(
        [
            `round ${String(entry.round).padStart(4)}`,
            `heapUsed ${(entry.heapUsed / MIB).toFixed(2)} MiB`,
            `rss ${(entry.rss / MIB).toFixed(1)} MiB`,
            `objects ${entry.objects}`,
            `thread items ${threads.reduce((sum, thread) => sum + thread.length, 0)}`,
            `threads as JSON ${(threads.reduce((sum, thread) => sum + JSON.stringify(thread).length, 0) / MIB).toFixed(2)} MiB`,
            `records written ${writes} (${(written / MIB).toFixed(0)} MiB)`
        ].join('\t')
    );
};

for (let i = 0; i < warmup; i++) {
    await round();
}
const first = sample(0);
const firstTypes = heapStats().objectTypeCounts;
report(first);
const samples: Sample[] = [first];
const started = performance.now();
for (let i = 1; i <= rounds; i++) {
    await round();
    const entry = sample(i);
    samples.push(entry);
    if (i % every === 0 || i === rounds) {
        report(entry);
    }
}
const last = samples.at(-1)!;

/* Least squares over every round, so one late collection does not decide the slope. */
const slope = (pick: (entry: Sample) => number): number => {
    const meanX = samples.reduce((sum, entry) => sum + entry.round, 0) / samples.length;
    const meanY = samples.reduce((sum, entry) => sum + pick(entry), 0) / samples.length;
    const over = samples.reduce((sum, entry) => sum + (entry.round - meanX) * (pick(entry) - meanY), 0);
    const under = samples.reduce((sum, entry) => sum + (entry.round - meanX) ** 2, 0);
    return under === 0 ? 0 : over / under;
};

console.log(
    [
        `${rounds} rounds of ${children.length} tasks with ${(outputBytes / 1024).toFixed(0)} KiB of tool output each, in ${((performance.now() - started) / 1000).toFixed(1)} s`,
        `heapUsed ${(first.heapUsed / MIB).toFixed(2)} -> ${(last.heapUsed / MIB).toFixed(2)} MiB, ${(slope((entry) => entry.heapUsed) / 1024).toFixed(1)} KiB per round`,
        `rss ${(first.rss / MIB).toFixed(1)} -> ${(last.rss / MIB).toFixed(1)} MiB, ${(slope((entry) => entry.rss) / 1024).toFixed(1)} KiB per round`,
        `objects ${first.objects} -> ${last.objects}, ${slope((entry) => entry.objects).toFixed(0)} per round`
    ].join('\n')
);

// A live chat holds its whole thread by design; what is left once every thread is cleared is what the rounds left elsewhere.
for (const chatId of chats()) {
    await daemon.chats.clear(chatId, true);
}
await daemon.worker.settled();
const cleared = sample(rounds);
console.log(
    `every thread cleared: heapUsed ${(cleared.heapUsed / MIB).toFixed(2)} MiB (${((cleared.heapUsed - first.heapUsed) / 1024).toFixed(0)} KiB above round 0), objects ${cleared.objects} (${cleared.objects - first.objects} above round 0), rss ${(cleared.rss / MIB).toFixed(1)} MiB`
);
if (values.types) {
    const counts = Object.entries(heapStats().objectTypeCounts)
        .map(([type, count]): [string, number] => [type, count - (firstTypes[type] ?? 0)])
        .filter(([, count]) => count !== 0)
        .sort((left, right) => right[1] - left[1]);
    console.log(counts.map(([type, count]) => `${type}\t${count > 0 ? '+' : ''}${count}`).join('\n'));
}

await daemon.stop();
store.closeAll();
await rm(root, { recursive: true, force: true });
