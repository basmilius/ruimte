import { appendFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentInfo } from '@ruimte/contracts';
import { ClaudeTitleReader } from '../agents/claude-title.ts';
import { CodexTitleReader } from '../agents/codex-title.ts';
import { Recorder, SH, SH_ARGS, makeHarness, waitFor, type Harness } from './test-helpers.ts';

let harness: Harness;
let transcript: string;
let codexIndex: string;
let recorder: Recorder;

beforeEach(async () => {
    harness = await makeHarness({ claudeTitles: new ClaudeTitleReader('') });
    transcript = join(harness.home, 'transcript.jsonl');
    codexIndex = join(harness.home, 'session_index.jsonl');
    await writeFile(transcript, '');
    await writeFile(codexIndex, '');
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

    test('a CLI that writes no name down is never asked for one', async () => {
        await harness.manager.create({ sessionId: 's2', cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home });
        await writeFile(transcript, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Not for gemini' })}\n`);
        await harness.manager.applyHook('gemini', harness.manager.get('s2')!.hookToken, hook('Stop'));
        await Bun.sleep(50);
        expect(lastAgent()).toMatchObject({ kind: 'gemini', status: 'idle' });
        expect(lastAgent()?.suggestedTitle).toBeUndefined();
    });

    test('a Codex thread takes the name from the index, also when it lands after the last hook', async () => {
        await harness.cleanup();
        const home = await mkdtemp(join(tmpdir(), 'ruimte-test-'));
        codexIndex = join(home, 'session_index.jsonl');
        await writeFile(codexIndex, '');
        harness = await makeHarness({ codexTitles: new CodexTitleReader(codexIndex), titleRetryMs: 30 }, home);
        recorder = new Recorder();
        harness.manager.subscribe('c1', recorder.sink());
        await harness.manager.create({ sessionId: 's3', cols: 80, rows: 24, shell: SH, args: SH_ARGS, cwd: harness.home });
        const token = harness.manager.get('s3')!.hookToken;

        await harness.manager.applyHook('codex', token, { session_id: 'thread-1', hook_event_name: 'Stop' });
        await waitFor(() => lastAgent()?.status === 'idle', 'the idle status');
        expect(lastAgent()?.suggestedTitle).toBeUndefined();

        // No hook comes after this line: the retry is what finds it.
        await appendFile(
            codexIndex,
            `${JSON.stringify({ id: 'other', thread_name: 'Someone else' })}\n${JSON.stringify({ id: 'thread-1', thread_name: 'Name the thread' })}\n`
        );
        await waitFor(() => lastAgent()?.suggestedTitle === 'Name the thread', 'the title on the status');
        expect(lastAgent()).toMatchObject({ kind: 'codex', agentSessionId: 'thread-1' });
    });
});
