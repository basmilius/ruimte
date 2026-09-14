import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentInfo } from '@ruimte/contracts';
import { ClaudeTitleReader } from '../agents/claude-title.ts';
import { Recorder, SH, SH_ARGS, makeHarness, waitFor, type Harness } from './test-helpers.ts';

let harness: Harness;
let transcript: string;
let recorder: Recorder;

beforeEach(async () => {
    harness = await makeHarness({ claudeTitles: new ClaudeTitleReader('') });
    transcript = join(harness.home, 'transcript.jsonl');
    await writeFile(transcript, '');
    recorder = new Recorder();
    harness.manager.subscribe('c1', recorder.sink());
});

afterEach(async () => {
    await harness.cleanup();
});

const hook = (event: string, sessionId = 'claude-1') => ({ session_id: sessionId, transcript_path: transcript, hook_event_name: event });

const lastAgent = (): AgentInfo | null => {
    const last = recorder.events.filter((event) => event.event === 'session.status').at(-1);
    return last?.event === 'session.status' ? last.payload.agent : null;
};

describe('the name of a terminal agent', () => {
    test('comes out of the transcript the hooks point at and stays with its conversation', async () => {
        await harness.manager.create({ sessionId: 's1', cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home });
        const token = harness.manager.get('s1')!.hookToken;

        await harness.manager.applyHook('claude', token, hook('UserPromptSubmit'));
        await waitFor(() => lastAgent()?.status === 'running', 'the running status');
        expect(lastAgent()?.suggestedTitle).toBeUndefined();

        await appendFile(transcript, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Tidy the build', sessionId: 'claude-1' })}\n`);
        await harness.manager.applyHook('claude', token, hook('Stop'));
        await waitFor(() => lastAgent()?.suggestedTitle === 'Tidy the build', 'the title on the status');

        // A later hook of the same conversation keeps it, a new conversation in the shell starts without.
        await harness.manager.applyHook('claude', token, hook('UserPromptSubmit'));
        expect(lastAgent()).toMatchObject({ status: 'running', suggestedTitle: 'Tidy the build' });
        await writeFile(transcript, '');
        await harness.manager.applyHook('claude', token, hook('UserPromptSubmit', 'claude-2'));
        expect(lastAgent()?.suggestedTitle).toBeUndefined();
    });

    test('a CLI other than Claude Code is never asked for one', async () => {
        await harness.manager.create({ sessionId: 's2', cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home });
        await writeFile(transcript, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Not for codex' })}\n`);
        await harness.manager.applyHook('codex', harness.manager.get('s2')!.hookToken, hook('Stop'));
        await Bun.sleep(50);
        expect(lastAgent()).toMatchObject({ kind: 'codex', status: 'idle' });
        expect(lastAgent()?.suggestedTitle).toBeUndefined();
    });
});
