import { expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { startDaemon } from './wire-client';

test('usage summaries match the frozen TypeScript parity fixture', async () => {
    const corpus = await Bun.file(join(import.meta.dir, 'fixtures/usage-oracle.json')).json();
    const expected = await Bun.file(join(import.meta.dir, 'fixtures/usage-summary-expected.json')).json();
    const native = await summaries(corpus);

    expect(expected.provenance).toBe('TypeScript daemon main@09fa3976');
    expect(native.violations).toEqual([]);
    expect(native.indexExists).toBe(true);
    expect(native.values).toEqual(expected.values);
}, 90_000);

const summaries = async (corpus: any) => {
    const daemon = await startDaemon();
    const client = await daemon.connect();
    try {
        const claude = join(daemon.home, 'claude/projects/test');
        const codex = join(daemon.home, 'codex/sessions');
        const cwd = join(daemon.home, 'project');
        await Promise.all([mkdir(claude, { recursive: true }), mkdir(codex, { recursive: true }), mkdir(cwd, { recursive: true })]);
        const project = await client.call('project.open', {
            folder: cwd,
            name: 'Usage Fixture',
            color: '#353e53'
        });
        const claudeLines = corpus.claude.map((record: any) => record.line.replaceAll('/work/α', cwd));
        await Bun.write(join(claude, 'a.jsonl'), `${claudeLines.join('\n')}\n`);
        await Bun.write(join(claude, 'duplicate.jsonl'), `${claudeLines[0]}\n`);
        const cumulative = corpus.codex.find((scenario: any) => scenario.name === 'cumulative');
        const codexLines = cumulative.steps.map((step: any) => step.line.replaceAll('/work/α', cwd));
        await Bun.write(join(codex, 'a.jsonl'), codexLines.join('\n'));

        const values = [];
        for (const timeZone of ['UTC', 'Europe/Amsterdam', 'America/New_York', 'Asia/Kathmandu', 'Bogus/Timezone']) {
            const result = await client.call('usage.summary', {
                from: '2026-09-01',
                to: '2026-09-30',
                resolution: 'hour',
                timeZone
            });
            const normalized = JSON.parse(JSON.stringify(result).replaceAll(daemon.home, '<home>').replaceAll(project.summary.projectId, '<project>'));
            delete normalized.scan.at;
            delete normalized.scan.durationMs;
            values.push(normalized);
        }
        return {
            indexExists: await Bun.file(join(daemon.home, 'usage/index.json')).exists(),
            values,
            violations: client.violations
        };
    } finally {
        client.close();
        await daemon.stop();
    }
};
