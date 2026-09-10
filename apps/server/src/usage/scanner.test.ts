import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageScanner } from './scanner.ts';
import type { UsageRootPath } from './roots.ts';

const made: string[] = [];

const workspace = async (): Promise<{ home: string; claude: string; codex: string; roots: UsageRootPath[] }> => {
    const base = await mkdtemp(join(tmpdir(), 'ruimte-usage-'));
    made.push(base);
    const claude = join(base, 'claude', 'projects');
    const codex = join(base, 'codex', 'sessions');
    await mkdir(claude, { recursive: true });
    await mkdir(codex, { recursive: true });
    return {
        home: join(base, 'home'),
        claude,
        codex,
        roots: [
            { provider: 'claude', path: claude },
            { provider: 'codex', path: codex }
        ]
    };
};

afterEach(async () => {
    await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const assistant = (id: string, seconds: number, output: number): string =>
    `${JSON.stringify({
        type: 'assistant',
        timestamp: new Date(Date.parse('2026-09-10T09:00:00.000Z') + seconds * 1000).toISOString(),
        sessionId: 's-1',
        cwd: '/work/repo',
        message: {
            id,
            model: 'claude-opus-5',
            usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: output }
        }
    })}\n`;

describe('the usage scanner', () => {
    test('reads both roots, keeps the index and opens nothing on a second pass', async () => {
        const { home, claude, codex, roots } = await workspace();
        await writeFile(join(claude, 'a.jsonl'), assistant('msg_1', 0, 40) + assistant('msg_2', 5, 60));
        await mkdir(join(codex, '2026'), { recursive: true });
        await writeFile(
            join(codex, '2026', 'b.jsonl'),
            [
                JSON.stringify({ type: 'session_meta', timestamp: '2026-09-10T09:00:00.000Z', payload: { id: 't-1', cwd: '/work/repo' } }),
                JSON.stringify({ type: 'turn_context', timestamp: '2026-09-10T09:00:01.000Z', payload: { model: 'gpt-5.6-sol' } }),
                JSON.stringify({
                    type: 'event_msg',
                    timestamp: '2026-09-10T09:00:02.000Z',
                    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 400, output_tokens: 30 } } }
                }),
                ''
            ].join('\n')
        );

        const scanner = new UsageScanner(home, roots);
        const first = await scanner.scan();
        expect(first.files).toBe(2);
        expect(first.changedFiles).toBe(2);
        expect(first.roots.every((root) => root.status === 'ok')).toBe(true);
        expect(scanner.records()).toHaveLength(3);
        await expect(stat(join(home, 'usage', 'index.json'))).resolves.toBeDefined();

        const second = await scanner.scan();
        expect(second.changedFiles).toBe(0);
        expect(scanner.records()).toHaveLength(3);

        // A fresh scanner starts from the index, without reading a transcript again.
        const warm = new UsageScanner(home, roots);
        const third = await warm.scan();
        expect(third.changedFiles).toBe(0);
        expect(warm.records()).toHaveLength(3);
    });

    test('reads only what a file added and counts a Codex turn once', async () => {
        const { home, codex, roots } = await workspace();
        const path = join(codex, 'grow.jsonl');
        const lines = [
            JSON.stringify({ type: 'session_meta', timestamp: '2026-09-10T09:00:00.000Z', payload: { id: 't-1', cwd: '/work/repo' } }),
            JSON.stringify({ type: 'turn_context', timestamp: '2026-09-10T09:00:01.000Z', payload: { model: 'gpt-5.6-sol' } }),
            JSON.stringify({
                type: 'event_msg',
                timestamp: '2026-09-10T09:00:02.000Z',
                payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 400, output_tokens: 30 } } }
            })
        ];
        await writeFile(path, `${lines.join('\n')}\n`);

        const scanner = new UsageScanner(home, roots);
        await scanner.scan();
        expect(scanner.records()).toHaveLength(1);

        const grown = JSON.stringify({
            type: 'event_msg',
            timestamp: '2026-09-10T09:01:00.000Z',
            payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 900, cached_input_tokens: 700, output_tokens: 50 } } }
        });
        await writeFile(path, `${[...lines, grown].join('\n')}\n`);
        const second = await scanner.scan();
        expect(second.changedFiles).toBe(1);
        const records = scanner.records();
        expect(records).toHaveLength(2);
        // The running total carried over, so the second turn is the difference and not the whole total.
        expect(records[1]!.totals).toEqual({ calls: 1, input: 100, cacheRead: 300, cacheWrite: 0, cacheWrite1h: 0, output: 20, reasoning: 0 });
    });

    test('reads a rewritten file from the start and keeps a file that has gone', async () => {
        const { home, claude, roots } = await workspace();
        const path = join(claude, 'a.jsonl');
        await writeFile(path, assistant('msg_1', 0, 40) + assistant('msg_2', 5, 60));
        const scanner = new UsageScanner(home, roots);
        await scanner.scan();
        expect(scanner.records()).toHaveLength(2);

        await writeFile(path, assistant('msg_3', 10, 15));
        await scanner.scan();
        expect(scanner.records()).toHaveLength(1);

        await rm(path);
        const gone = await scanner.scan();
        expect(gone.files).toBe(0);
        // Claude Code removes old transcripts; what they counted still happened.
        expect(scanner.records()).toHaveLength(1);
    });

    test('says which root is not there instead of failing the pass', async () => {
        const { home } = await workspace();
        const scanner = new UsageScanner(home, [{ provider: 'claude', path: join(home, 'nowhere') }]);
        const report = await scanner.scan();
        expect(report.roots).toEqual([{ provider: 'claude', path: join(home, 'nowhere'), status: 'missing', message: null }]);
        expect(scanner.records()).toHaveLength(0);
    });

    test('a line still being written is counted once, not twice', async () => {
        const { home, claude, roots } = await workspace();
        const path = join(claude, 'a.jsonl');
        const partial = assistant('msg_1', 0, 40);
        await writeFile(path, partial + assistant('msg_2', 5, 60).trimEnd());
        const scanner = new UsageScanner(home, roots);
        await scanner.scan();
        expect(scanner.records()).toHaveLength(2);

        await writeFile(path, partial + assistant('msg_2', 5, 60) + assistant('msg_3', 9, 20));
        await scanner.scan();
        expect(scanner.records()).toHaveLength(3);
    });
});
