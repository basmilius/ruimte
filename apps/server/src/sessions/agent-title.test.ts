import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { AgentInfo } from '@ruimte/contracts';
import { ClaudeTitleReader } from '../agents/claude-title.ts';
import { CodexTitleReader } from '../agents/codex-title.ts';
import { Recorder, makeHarness, type Harness } from './test-helpers.ts';

let harness: Harness;
let transcript: string;
let recorder: Recorder;

/* Every read the manager starts, so a test awaits the read itself rather than a guess at how long it takes. */
class Reads {
    readonly started: Array<Promise<string | null>> = [];

    track(read: Promise<string | null>): Promise<string | null> {
        this.started.push(read);
        return read;
    }

    /* Waits for every read started so far and for the agent record a title it found writes. */
    async settled(): Promise<void> {
        await Promise.allSettled(this.started);
        await harness.agents.settled();
    }
}

let reads: Reads;

const start = async (extra: Parameters<typeof makeHarness>[0]): Promise<void> => {
    harness = await makeHarness(extra);
    transcript = join(harness.home, 'transcript.jsonl');
    await writeFile(transcript, '');
    recorder = new Recorder();
    harness.manager.subscribe('c1', recorder.sink());
    await harness.manager.create({ sessionId: 's1', cols: 80, rows: 24, cwd: harness.home });
};

beforeEach(async () => {
    reads = new Reads();
    const claude = new ClaudeTitleReader('');
    await start({ claudeTitles: { forTranscript: (path) => reads.track(claude.forTranscript(path)) } });
});

afterEach(async () => {
    jest.useRealTimers();
    await harness.cleanup();
});

const hook = (event: string, sessionId = 'claude-1') => ({ session_id: sessionId, transcript_path: transcript, hook_event_name: event });

const token = (): string => harness.manager.get('s1')!.hookToken;

const lastAgent = (): AgentInfo | null => {
    const last = recorder.events.filter((event) => event.event === 'session.status').at(-1);
    return last?.event === 'session.status' ? last.payload.agent : null;
};

describe('the name of a terminal agent', () => {
    test('comes out of the transcript the hooks point at and stays with its conversation', async () => {
        await harness.manager.applyHook('claude', token(), hook('UserPromptSubmit'));
        await reads.settled();
        expect(lastAgent()).toMatchObject({ status: 'running' });
        expect(lastAgent()?.suggestedTitle).toBeUndefined();

        await appendFile(transcript, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Tidy the build', sessionId: 'claude-1' })}\n`);
        await harness.manager.applyHook('claude', token(), hook('Stop'));
        await reads.settled();
        expect(lastAgent()?.suggestedTitle).toBe('Tidy the build');

        // A later hook of the same conversation keeps it, a new conversation in the shell starts without.
        await harness.manager.applyHook('claude', token(), hook('UserPromptSubmit'));
        expect(lastAgent()).toMatchObject({ status: 'running', suggestedTitle: 'Tidy the build' });
        await writeFile(transcript, '');
        await harness.manager.applyHook('claude', token(), hook('UserPromptSubmit', 'claude-2'));
        expect(lastAgent()?.suggestedTitle).toBeUndefined();
        await reads.settled();
    });

    test('a CLI that writes no name down is never asked for one', async () => {
        await writeFile(transcript, `${JSON.stringify({ type: 'ai-title', aiTitle: 'Not for gemini' })}\n`);
        await harness.manager.applyHook('gemini', token(), hook('Stop'));
        expect(reads.started).toEqual([]);
        expect(lastAgent()).toMatchObject({ kind: 'gemini', status: 'idle' });
        expect(lastAgent()?.suggestedTitle).toBeUndefined();
    });

    test('a Codex thread takes the name from the index, also when it lands after the last hook', async () => {
        await harness.cleanup();
        reads = new Reads();
        let codex: CodexTitleReader | null = null;
        await start({ codexTitles: { forThread: (threadId) => reads.track(codex!.forThread(threadId)) } });
        const codexIndex = join(harness.home, 'session_index.jsonl');
        await writeFile(codexIndex, '');
        codex = new CodexTitleReader(codexIndex);
        jest.useFakeTimers();

        await harness.manager.applyHook('codex', token(), { session_id: 'thread-1', hook_event_name: 'Stop' });
        await reads.settled();
        expect(lastAgent()).toMatchObject({ status: 'idle' });
        expect(lastAgent()?.suggestedTitle).toBeUndefined();
        expect(reads.started).toHaveLength(1);

        // No hook comes after this line: the retry is what finds it.
        await appendFile(
            codexIndex,
            `${JSON.stringify({ id: 'other', thread_name: 'Someone else' })}\n${JSON.stringify({ id: 'thread-1', thread_name: 'Name the thread' })}\n`
        );
        jest.advanceTimersByTime(14_999);
        expect(reads.started).toHaveLength(1);
        jest.advanceTimersByTime(1);
        expect(reads.started).toHaveLength(2);
        await reads.settled();
        expect(lastAgent()).toMatchObject({ kind: 'codex', agentSessionId: 'thread-1', suggestedTitle: 'Name the thread' });
    });
});
