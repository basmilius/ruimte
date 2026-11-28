import { afterEach, describe, expect, test } from 'bun:test';
import { makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;

afterEach(async () => {
    await harness.cleanup();
});

describe('a session of a node with a terminal profile', () => {
    test('starts the program the profile describes, with its variables, where it says, unheld and counted as a terminal', async () => {
        const asked: string[] = [];

        harness = await makeHarness({
            profileFor: async (sessionId, cwd) => {
                asked.push(`${sessionId} ${cwd}`);

                return sessionId === 'shell' ? { exec: "'sh' '-l'", env: { HARBOR_SERVICE: 'web' }, cwd: '/tmp' } : null;
            }
        });

        const info = await harness.create('shell');
        const pty = harness.adapter.forSession('shell');

        expect(asked).toEqual([`shell ${harness.home}`]);
        expect(pty.options.args.slice(-2)).toEqual(['-c', "'sh' '-l'"]);
        expect(pty.options.env.HARBOR_SERVICE).toBe('web');
        expect(pty.options.cwd).toBe('/tmp');
        expect(info.heldCommand).toBeUndefined();
        expect(pty.typed).toBe('');
    });

    test('is a plain shell that says why when its extension gave nothing to start', async () => {
        harness = await makeHarness({ profileFor: async () => ({ notice: 'Ruimte: dev.harbor did not start this terminal, so it is a plain shell.' }) });

        await harness.create('shell');

        expect(harness.adapter.forSession('shell').options.args).not.toContain('-c');
        expect(await harness.manager.get('shell')?.plainText()).toContain('dev.harbor did not start this terminal');
    });

    test('keeps the command or the agent of a node that names one, and asks nothing for a session that runs', async () => {
        let asks = 0;

        harness = await makeHarness({
            profileFor: async () => {
                asks += 1;

                return { exec: 'sh' };
            }
        });

        await harness.create('typed', { command: 'ls' });
        await harness.create('shell');
        await expect(harness.create('shell')).rejects.toMatchObject({ code: 'session-exists' });

        expect(asks).toBe(1);
        expect(harness.adapter.forSession('typed').options.args).not.toContain('-c');
    });
});

describe('whether an agent in a session waits for the person', () => {
    test('follows what its hooks report: a question or an approval, until it goes on', async () => {
        harness = await makeHarness();

        const { sessionId } = await harness.create('shell');
        const token = harness.adapter.forSession(sessionId).options.env.RUIMTE_HOOK_TOKEN as string;
        const hook = (body: object): Promise<unknown> => harness.manager.applyHook('claude', token, { session_id: 'conversation-1', ...body });

        expect(harness.manager.awaitsPerson(sessionId)).toBe(false);

        await hook({ hook_event_name: 'UserPromptSubmit' });

        expect(harness.manager.awaitsPerson(sessionId)).toBe(false);

        await hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });

        expect(harness.manager.get(sessionId)?.agent?.status).toBe('needs-you');
        expect(harness.manager.awaitsPerson(sessionId)).toBe(true);

        await hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });

        expect(harness.manager.awaitsPerson(sessionId)).toBe(false);
        expect(harness.manager.awaitsPerson('elsewhere')).toBe(false);
    });
});
