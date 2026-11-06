import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ProviderRegistry } from '../providers/registry.ts';
import { makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;
const pending = new Set<() => void>();

beforeEach(async () => {
    harness = await makeHarness();
});

afterEach(async () => {
    for (const resolve of pending) {
        resolve();
    }
    pending.clear();
    await harness.cleanup();
});

async function withPreparation() {
    await harness.cleanup();
    const ready = Promise.withResolvers<void>();
    const preparing = Promise.withResolvers<void>();
    pending.add(ready.resolve);
    const registry = new ProviderRegistry();
    const codex = registry.get('codex');
    harness = await makeHarness({
        providers: {
            kinds: () => registry.kinds(),
            // Codex is the CLI that needs preparing; the wait is held here until the test lets it go.
            get: (kind) =>
                kind === 'codex'
                    ? {
                          ...codex,
                          terminal: {
                              ...codex.terminal,
                              prepare: () => {
                                  preparing.resolve();
                                  return ready.promise;
                              }
                          }
                      }
                    : registry.get(kind)
        }
    });
    return { ready, preparing };
}

function create(sessionId: string, kind?: 'codex' | 'claude') {
    return harness.manager.create({ sessionId, cols: 80, rows: 24, cwd: harness.home, ...(kind ? { agent: { kind } } : {}) });
}

test('only a CLI that needs preparation waits before its first command is built', async () => {
    const { ready, preparing } = await withPreparation();
    const starting = create('codex', 'codex');
    expect(await Promise.race([starting.then(() => 'spawned'), preparing.promise.then(() => 'preparing')])).toBe('preparing');
    try {
        await create('shell');
        await create('claude', 'claude');
        expect(harness.manager.get('codex')).toBeUndefined();
        expect(harness.adapter.spawned).toHaveLength(2);
    } finally {
        ready.resolve();
        await starting;
    }
    const pty = harness.adapter.forSession('codex');
    expect(pty.input.join('') + (pty.options.env.RUIMTE_START_LINE ?? '')).toContain('codex');
});

for (const state of ['open', 'ended', 'agent-live'] as const) {
    test(`a pending CLI preparation protects resume when the session becomes ${state}`, async () => {
        const { ready, preparing } = await withPreparation();
        await create('shell');
        const session = harness.manager.get('shell')!;
        await harness.manager.applyHook('codex', session.hookToken, { hook_event_name: 'UserPromptSubmit', session_id: 'codex-saved' });
        harness.manager.isAgentGone = () => true;
        const pty = harness.adapter.forSession('shell');
        const resuming = harness.manager.resumeAgent('shell');
        const outcome = resuming.then(
            () => 'resumed',
            (error: Error) => error.message
        );
        expect(await Promise.race([outcome, preparing.promise.then(() => 'preparing')])).toBe('preparing');
        expect(pty.input).toEqual([]);
        await expect(harness.manager.resumeAgent('shell')).rejects.toThrow('typed already');
        if (state === 'ended') {
            pty.exit(0);
            await pty.exited;
        } else if (state === 'agent-live') {
            harness.manager.isAgentGone = () => false;
            await harness.manager.applyHook('codex', session.hookToken, { hook_event_name: 'UserPromptSubmit', session_id: 'codex-saved' });
        }
        ready.resolve();
        if (state === 'ended') {
            expect(await outcome).toContain('has ended');
            expect(pty.input).toEqual([]);
        } else if (state === 'agent-live') {
            expect(await outcome).toContain('still running');
            expect(pty.input).toEqual([]);
        } else {
            expect(await outcome).toBe('resumed');
            expect(pty.input.join('')).toContain('codex resume');
        }
    });
}

test('a restored Codex terminal opens its shell while preparation continues', async () => {
    const { preparing } = await withPreparation();
    await create('restored');
    await harness.manager.applyHook('codex', harness.manager.get('restored')!.hookToken, { hook_event_name: 'UserPromptSubmit', session_id: 'saved' });
    const previous = harness.adapter.forSession('restored');
    previous.exit(0);
    await previous.exited;
    await harness.agents.settled();
    expect(await Promise.race([create('restored', 'codex').then(() => 'spawned'), preparing.promise.then(() => 'preparing')])).toBe('spawned');
    expect(harness.adapter.forSession('restored').input).toEqual([]);
    expect(harness.manager.get('restored')!.agent?.agentSessionId).toBe('saved');
});
