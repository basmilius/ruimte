import { afterEach, beforeEach, expect, test } from 'bun:test';
import { PendingPromptStore } from '../agents/pending-prompts.ts';
import { makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;
let prompts: PendingPromptStore | null;

beforeEach(async () => {
    prompts = null;
    // The store lives in the home the harness makes, so it is only built once that home is there.
    harness = await makeHarness({ firstPrompt: (sessionId) => prompts?.take(sessionId) ?? Promise.resolve(null) });
    prompts = new PendingPromptStore(harness.home);
});

afterEach(async () => {
    await harness.cleanup();
});

const start = (sessionId: string) =>
    harness.manager.create({ sessionId, cols: 80, rows: 24, cwd: harness.home, agent: { kind: 'claude', runtimeMode: 'supervised' } });

test('the prompt an agent node was made with lands on the line its CLI is started with', async () => {
    await prompts!.put('project', 'terminal-a', 'say hello');
    await start('terminal-a');
    expect(harness.adapter.forSession('terminal-a').input).toEqual(["claude 'say hello'\n"]);
    expect(prompts!.has('terminal-a')).toBe(false);
});

test('a session without a prompt is started the way it always was', async () => {
    await start('terminal-b');
    expect(harness.adapter.forSession('terminal-b').input).toEqual(['claude\n']);
});

test('two creates of one id at once, the machine starting the node and a client mounting it, spawn one shell', async () => {
    await prompts!.put('project', 'terminal-c', 'say hello');
    const [started, mounted] = await Promise.all([start('terminal-c'), start('terminal-c')]);
    expect(mounted).toEqual(started);
    expect(harness.adapter.spawned.filter((pty) => pty.options.env.RUIMTE_SESSION_ID === 'terminal-c')).toHaveLength(1);
    expect(harness.adapter.forSession('terminal-c').input).toEqual(["claude 'say hello'\n"]);
    // Once it stands, a create is the client's usual `session-exists`, which it answers by attaching.
    await expect(start('terminal-c')).rejects.toMatchObject({ code: 'session-exists' });
});

test('a kill that arrives while the session is being made ends the session that was made', async () => {
    const creating = start('terminal-d');
    const killed = harness.manager.kill('terminal-d');
    await creating;
    await killed;
    expect(harness.adapter.forSession('terminal-d').signals.length).toBeGreaterThan(0);
});
