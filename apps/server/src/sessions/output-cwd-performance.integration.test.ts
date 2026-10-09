import { expect, test } from 'bun:test';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { Terminal } from '@xterm/headless';
import { trackTerminalCwd } from '@ruimte/contracts';
import { clientDirectory, withBrowserFixture } from '../../../client/testing/browser-fixture';

// Measurements belong in integration checks: machine load must not turn a unit test red.
test('cwd tracking remains bounded over 50000 lines, measured against bare headless and browser xterm', async () => {
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
    const terminalPackage = await realpath(join(clientDirectory, 'node_modules/@adecore/terminal'));
    await withBrowserFixture(
        `import {Terminal} from ${JSON.stringify(Bun.resolveSync('@xterm/xterm', terminalPackage))};
         import {trackTerminalCwd} from ${JSON.stringify(join(import.meta.dir, '../../../../packages/contracts/src/terminal-cwd.ts'))};
         window.measure=async(prefix,chunk,tracked)=>{
            const term=new Terminal({cols:80,rows:24,scrollback:10000,allowProposedApi:true});
            const cwd=tracked?trackTerminalCwd(term):null;const start=performance.now();
            await new Promise(resolve=>term.write(prefix,resolve));
            for(let offset=0;offset<50000;offset+=chunk)await new Promise(resolve=>term.write('same.ts:12:4-16\\r\\n'.repeat(Math.min(chunk,50000-offset)),resolve));
            const result={ms:Math.round(performance.now()-start),markers:term.markers.length,lines:term.buffer.normal.length};
            cwd?.dispose();term.dispose();return result;
         };`,
        '',
        async (view) => {
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
        }
    );
}, 30000);
