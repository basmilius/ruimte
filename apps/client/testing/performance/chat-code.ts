import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { median } from './bench';

const client = join(import.meta.dir, '../..');
const shared = realpathSync(join(client, 'node_modules/@adecore/agents-react/src'));
const { codeHighlighter } = await import(join(shared, 'chat/ui/highlighter.ts'));
const { IncrementalLines } = await import(join(shared, 'chat/ui/code-lines.ts'));
const { createHighlighter } = await import(Bun.resolveSync('shiki/bundle/web', client));
const shiki = await createHighlighter({ themes: ['github-dark'], langs: ['typescript'] });
const highlighter = codeHighlighter(async () => shiki);
await Promise.all([highlighter.loadLanguage('typescript'), highlighter.loadTheme('github-dark', [])]);
const tokenizer = highlighter.tokenizer('typescript', 'github-dark')!;
const blocks = Array.from({ length: 20 }, (_, block) =>
    Array.from({ length: 80 }, (_, line) => `const value${block}_${line}: string = "content ${line}";`).join('\n')
);
const samples = [];
let tokenLines = 0;
for (let pass = 0; pass < 11; pass++) {
    const started = performance.now();
    for (const code of blocks) {
        const result = new IncrementalLines(tokenizer.tokenize).update(code, true);
        tokenLines += result.length;
        if (result.map((line: { content: string }[]) => line.map((token) => token.content).join('')).join('\n') !== code) {
            throw new Error('Highlighted code changed');
        }
    }
    samples.push(performance.now() - started);
}
console.log(JSON.stringify({ benchmark: 'revisit-chat-code', blocks: blocks.length, linesPerBlock: 80, tokenLines, samples }, null, 2));
shiki.dispose();
const maxWarm = Number(process.env.BENCH_MAX_WARM_MS ?? Infinity);
if (median(samples.slice(1)) > maxWarm) {
    throw new Error(`Repeated syntax work exceeded ${maxWarm} ms`);
}
