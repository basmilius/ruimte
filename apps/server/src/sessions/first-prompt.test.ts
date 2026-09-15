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
