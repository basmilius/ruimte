import { resolve } from 'node:path';
import { Terminal } from '@xterm/headless';

const terminal = new Terminal({ allowProposedApi: true });
if (terminal.unicode.activeVersion !== '6') {
    throw new Error(`Expected xterm Unicode 6, got ${terminal.unicode.activeVersion}`);
}
const service = (terminal as unknown as { _core: { unicodeService: { wcwidth(codepoint: number): number } } })._core.unicodeService;
const ranges: number[][] = [];
let start = 0;
let previous = service.wcwidth(0);
for (let codepoint = 1; codepoint <= 0x110000; codepoint++) {
    const width = codepoint === 0x110000 ? -1 : service.wcwidth(codepoint);
    if (width !== previous) {
        if (previous !== 1) {
            ranges.push([start, codepoint - 1, previous]);
        }
        start = codepoint;
        previous = width;
    }
}
terminal.dispose();
const output = `${JSON.stringify(
    {
        source: '@xterm/headless 6.0.0 default UnicodeV6 (MIT)',
        unicodeVersion: '6',
        defaultWidth: 1,
        ranges
    },
    null,
    2
)}\n`;
const fixture = resolve(import.meta.dir, 'unicode-width-v6.json');
if (process.argv.includes('--check')) {
    if ((await Bun.file(fixture).text()) !== output) {
        throw new Error('unicode-width-v6.json is stale');
    }
} else {
    await Bun.write(fixture, output);
}
