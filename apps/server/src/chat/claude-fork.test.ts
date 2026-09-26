import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cutTranscript, forkClaudeTranscript } from './claude-fork.ts';
import { claudeProjectSlug } from '@ruimte/agents/chat/claude-transcript';
import { ChatError } from './errors.ts';

const SESSION = 'ef133c61-7c0d-4182-9b8f-40f5214adbdf';
const FORK = '04d373e9-dd60-4612-9381-7bb0827ac6a5';

const line = (entry: Record<string, unknown>): string => JSON.stringify(entry);

/* One turn the way Claude Code 2.1.273 writes it: the queue lines, the prompt, what it attached, the answer and what trails it. */
const turn = (n: number, parent: string | null): string[] => [
    line({ type: 'queue-operation', operation: 'enqueue', sessionId: SESSION, content: `prompt ${n}` }),
    line({ type: 'queue-operation', operation: 'dequeue', sessionId: SESSION }),
    line({ type: 'user', uuid: `u${n}`, parentUuid: parent, isSidechain: false, sessionId: SESSION, message: { role: 'user', content: `prompt ${n}` } }),
    line({ type: 'attachment', uuid: `a${n}`, parentUuid: `u${n}`, isSidechain: false, sessionId: SESSION, attachment: {} }),
    line({ type: 'assistant', uuid: `t${n}`, parentUuid: `a${n}`, isSidechain: false, sessionId: SESSION, message: { content: [{ type: 'thinking' }] } }),
    line({
        type: 'assistant',
        uuid: `r${n}`,
        parentUuid: `t${n}`,
        isSidechain: false,
        sessionId: SESSION,
        message: { content: [{ type: 'text', text: `answer ${n}` }] }
    }),
    line({ type: 'system', uuid: `s${n}`, parentUuid: `r${n}`, isSidechain: false, sessionId: SESSION, subtype: 'turn_duration' }),
    line({ type: 'last-prompt', sessionId: SESSION, lastPrompt: `prompt ${n}` })
];

const transcript = (): string =>
    [
        line({ type: 'ai-title', sessionId: SESSION, aiTitle: 'Four turns' }),
        ...turn(1, null),
        // A tool result and an injected skill are no prompt, so they never end a turn.
        line({
            type: 'user',
            uuid: 'u1-meta',
            isSidechain: false,
            isMeta: true,
            sessionId: SESSION,
            message: { role: 'user', content: [{ type: 'text', text: 'skill' }] }
        }),
        ...turn(2, 's1'),
        line({
            type: 'user',
            uuid: 'u2-tool',
            isSidechain: false,
            sessionId: SESSION,
            message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] }
        }),
        line({ type: 'file-history-snapshot', messageId: 'r2', snapshot: {} }),
        ...turn(3, 's2'),
        ...turn(4, 's3')
    ].join('\n') + '\n';

const parse = (text: string): Record<string, unknown>[] =>
    text
        .trim()
        .split('\n')
        .map((raw) => JSON.parse(raw) as Record<string, unknown>);

describe('cutTranscript', () => {
    test('a cut at the last answer of turn 2 keeps every line up to the prompt of turn 3, all under the new session id', () => {
        const lines = parse(cutTranscript(transcript(), { lastUuid: 'r2' }, SESSION, FORK));
        const last = lines.at(-1)!;
        expect(last).toMatchObject({ type: 'file-history-snapshot' });
        expect(lines.some((entry) => entry.uuid === 'u3')).toBe(false);
        // The queue lines of turn 3 carry its prompt, so they go with it.
        expect(lines.some((entry) => entry.content === 'prompt 3')).toBe(false);
        expect(lines.filter((entry) => 'sessionId' in entry).every((entry) => entry.sessionId === FORK)).toBe(true);
        expect(lines.map((entry) => entry.uuid).filter(Boolean)).toEqual(['u1', 'a1', 't1', 'r1', 's1', 'u1-meta', 'u2', 'a2', 't2', 'r2', 's2', 'u2-tool']);
    });

    test('counting prompts cuts in the same place as the uuid does, which is what an older turn has', () => {
        expect(cutTranscript(transcript(), { turns: 2 }, SESSION, FORK)).toBe(cutTranscript(transcript(), { lastUuid: 'r2' }, SESSION, FORK));
    });

    test('the whole transcript moves to the new session id and loses nothing', () => {
        const whole = parse(cutTranscript(transcript(), 'whole', SESSION, FORK));
        expect(whole).toHaveLength(parse(transcript()).length);
        expect(cutTranscript(transcript(), { lastUuid: 'r4' }, SESSION, FORK)).toBe(cutTranscript(transcript(), 'whole', SESSION, FORK));
    });

    test('a file of another shape is refused with the version it was checked against, and a turn it lacks is not found', () => {
        const refusal = (run: () => unknown): ChatError | null => {
            try {
                run();
                return null;
            } catch (e) {
                return e as ChatError;
            }
        };
        expect(refusal(() => cutTranscript('not json\n', 'whole', SESSION, FORK))).toMatchObject({ code: 'transcript-format' });
        expect(refusal(() => cutTranscript(transcript(), 'whole', 'another-session', FORK))?.message).toContain('2.1.273');
        expect(refusal(() => cutTranscript(transcript(), { lastUuid: 'nowhere' }, SESSION, FORK))).toMatchObject({ code: 'transcript-format' });
        expect(refusal(() => cutTranscript(transcript(), { turns: 9 }, SESSION, FORK))).toMatchObject({ code: 'turn-not-found' });
    });
});

describe('forkClaudeTranscript', () => {
    let projects: string;

    beforeEach(async () => {
        projects = await mkdtemp(join(tmpdir(), 'ruimte-claude-fork-'));
    });

    afterEach(async () => {
        await rm(projects, { recursive: true, force: true });
    });

    test('the copy lands in the folder of the directory the fork works in, found by session id elsewhere, and undo removes it', async () => {
        const elsewhere = join(projects, 'some-other-slug');
        await mkdir(elsewhere, { recursive: true });
        await writeFile(join(elsewhere, `${SESSION}.jsonl`), transcript());
        const written = await forkClaudeTranscript({
            projectsDir: projects,
            cwd: '/work/lexer',
            sessionId: SESSION,
            at: { lastUuid: 'r1' },
            forkCwd: '/work/lexer-fork',
            newSessionId: FORK
        });
        expect(written.path).toBe(join(projects, claudeProjectSlug('/work/lexer-fork'), `${FORK}.jsonl`));
        expect(parse(await readFile(written.path, 'utf8')).some((entry) => entry.uuid === 'u2')).toBe(false);
        await written.undo();
        expect(await Bun.file(written.path).exists()).toBe(false);
    });

    test('a session with no transcript anywhere is refused with the path it was looked for at', async () => {
        const attempt = forkClaudeTranscript({
            projectsDir: projects,
            cwd: '/work/lexer',
            sessionId: SESSION,
            at: 'whole',
            forkCwd: '/work/lexer',
            newSessionId: FORK
        });
        await expect(attempt).rejects.toMatchObject({ code: 'transcript-missing', message: expect.stringContaining(claudeProjectSlug('/work/lexer')) });
    });
});
