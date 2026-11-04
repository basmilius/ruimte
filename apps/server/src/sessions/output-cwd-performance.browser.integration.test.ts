import { expect, test } from 'bun:test';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { trackTerminalCwd } from '@ruimte/contracts';
import { Terminal } from '@xterm/headless';
import { clientDirectory, withBrowserFixture } from '../../../client/testing/browser-fixture.ts';

async function browserEntry(): Promise<string> {
    const terminalPackage = await realpath(join(clientDirectory, 'node_modules/@adecore/terminal'));
    return `import {Terminal} from ${JSON.stringify(Bun.resolveSync('@xterm/xterm', terminalPackage))};
         import {trackTerminalCwd} from ${JSON.stringify(join(import.meta.dir, '../../../../packages/contracts/src/terminal-cwd.ts'))};
         window.measure=async(prefix,chunk,tracked)=>{
            const term=new Terminal({cols:80,rows:24,scrollback:10000,allowProposedApi:true});
            const cwd=tracked?trackTerminalCwd(term):null;const start=performance.now();
            try {
                await new Promise(resolve=>term.write(prefix,resolve));
                for(let offset=0;offset<50000;offset+=chunk)await new Promise(resolve=>term.write('same.ts:12:4-16\\r\\n'.repeat(Math.min(chunk,50000-offset)),resolve));
                return {ms:Math.round(performance.now()-start),markers:term.markers.length,lines:term.buffer.normal.length,
                    first:cwd?.at(1)??null,last:cwd?.at(term.buffer.normal.length)??null,snapshotBytes:cwd?.snapshot(10000).length??0};
            } finally {cwd?.dispose();term.dispose();}
         };`;
}

test('browser cwd tracking keeps bounded scrollback and the retained directory across chunk sizes', async () => {
    await withBrowserFixture(await browserEntry(), '', async (view) => {
        for (const prefix of ['', '\x1b]7;file://localhost/repo\x07']) {
            for (const chunk of [50000, 128]) {
                const result = await view.evaluate<{ markers: number; lines: number; first: string | null; last: string | null; snapshotBytes: number }>(
                    `window.measure(${JSON.stringify(prefix)},${chunk},true)`
                );
                expect(result.markers).toBeLessThanOrEqual(prefix ? 1 : 0);
                expect(result.lines).toBe(10024);
                expect(result.first).toBe(prefix ? '/repo' : null);
                expect(result.last).toBe(prefix ? '/repo' : null);
                expect(result.snapshotBytes).toBeLessThan(300);
            }
        }
    });
}, 30000);

// Optional measurements have no timing threshold and are excluded from ordinary browser correctness runs.
test.skipIf(process.env.RUIMTE_CWD_BENCHMARK !== '1')(
    'measures cwd tracking against bare headless and browser xterm over 50000 lines',
    async () => {
        const cases = [
            { name: 'without metadata', prefix: '' },
            { name: 'one directory', prefix: '\x1b]7;file://localhost/repo\x07' }
        ];
        for (const { name, prefix } of cases) {
            for (const chunk of [50000, 128]) {
                const measurements: Record<string, number> = {};
                for (const tracked of [false, true]) {
                    const term = new Terminal({ cols: 80, rows: 24, scrollback: 10000, allowProposedApi: true });
                    const cwd = tracked ? trackTerminalCwd(term) : null;
                    const started = performance.now();
                    await new Promise<void>((resolve) => term.write(prefix, resolve));
                    for (let offset = 0; offset < 50000; offset += chunk) {
                        await new Promise<void>((resolve) => term.write('same.ts:12:4-16\r\n'.repeat(Math.min(chunk, 50000 - offset)), resolve));
                    }
                    measurements[tracked ? 'trackedMs' : 'bareMs'] = Math.round(performance.now() - started);
                    expect(term.markers.length).toBeLessThanOrEqual(1);
                    expect(term.buffer.normal.length).toBe(10024);
                    cwd?.dispose();
                    term.dispose();
                }
                console.log('headless', name, { chunk, ...measurements });
            }
        }
        await withBrowserFixture(await browserEntry(), '', async (view) => {
            for (const { name, prefix } of cases) {
                for (const chunk of [50000, 128]) {
                    const measurements: Record<string, number> = {};
                    for (const tracked of [false, true]) {
                        const result = await view.evaluate<{ ms: number; markers: number; lines: number }>(
                            `window.measure(${JSON.stringify(prefix)},${chunk},${tracked})`
                        );
                        measurements[tracked ? 'trackedMs' : 'bareMs'] = result.ms;
                        expect(result.markers).toBeLessThanOrEqual(1);
                        expect(result.lines).toBe(10024);
                    }
                    console.log('browser', name, { chunk, ...measurements });
                }
            }
        });
    },
    30000
);
