import { afterEach, beforeEach, expect, test } from 'bun:test';
import { PendingPromptStore } from '../agents/pending-prompts.ts';
import { CLEAN_PATH, Recorder, SH, SH_ARGS, makeHarness, waitFor, type Harness } from './test-helpers.ts';

let harness: Harness;
let prompts: PendingPromptStore | null;
let recorder: Recorder;

beforeEach(async () => {
    prompts = null;
    recorder = new Recorder();
    // The store lives in the home the harness makes, so it is only built once that home is there.
    harness = await makeHarness({ env: { PATH: CLEAN_PATH, PS1: '$ ' }, firstPrompt: (sessionId) => prompts?.take(sessionId) ?? Promise.resolve(null) });
    prompts = new PendingPromptStore(harness.home);
    harness.manager.subscribe('client', recorder.sink());
});

afterEach(async () => {
    await harness.cleanup();
});

const start = async (sessionId: string): Promise<void> => {
    await harness.manager.create({
        sessionId,
        cols: 80,
        rows: 24,
        shell: SH,
        args: SH_ARGS,
        cwd: harness.home,
        agent: { kind: 'claude', runtimeMode: 'supervised' }
    });
    await harness.manager.attach(sessionId, 'client', 80, 24);
};

test('the prompt an agent node was made with lands on the line its CLI is started with', async () => {
    await prompts!.put('project', 'terminal-a', 'say hello');
    await start('terminal-a');
    // No claude on this PATH, so the shell echoes the line it was handed and nothing runs.
    await waitFor(() => recorder.output.includes('say hello'), 'the prompt on the launch line');
    expect(recorder.output).toContain("claude 'say hello'");
    expect(prompts!.has('terminal-a')).toBe(false);
});

test('a session without a prompt is started the way it always was', async () => {
    await start('terminal-b');
    await waitFor(() => recorder.output.includes('claude'), 'the launch line');
    expect(recorder.output).not.toContain("'");
});
