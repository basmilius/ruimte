import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { compileUiBlock } from '@adecore/intelligent-ui';
import { z } from 'zod';
import { evaluateNativeUi, type NativeUiRequest } from '../src/chat/native-ui';

const cases = [
    { name: 'local input', source: '$count = 2\n<Slider value={$count} min={0} max={10} >Count</Slider><Summary>Total {@Count([1,2,3]) + $count}</Summary>' },
    {
        name: 'conditional repetition',
        source: '$show = true\n<Switch value={$show}>Show</Switch><Show when={$show}><Each items={[{name:"a"},{name:"b"}]} as="row"><Tag>{$row.name}</Tag></Each></Show>'
    },
    { name: 'choice and file', source: '$path = "readme.md"\n<File path={$path}/><Choices><Choice context="Read the file">Read</Choice></Choices>' },
    {
        name: 'query result',
        source: '$status = @Query("git.status", {})\n<Stats><Stat label="Files" value={@Count($status.files)}/></Stats>',
        queries: { $status: { files: ['a', 'b'] } }
    },
    { name: 'unknown component', source: '<Summary>Still visible</Summary><FutureWidget>Future fallback</FutureWidget>' },
    { name: 'partial stream', source: '<Summary>Streaming</Summary><Stats><Stat label="Files" value={3}', final: false },
    { name: 'prototype access', source: '$record = {safe:1}\n<Summary>{$record.constructor}</Summary>' },
    { name: 'unknown catalog', source: '<Summary>Old client</Summary>', catalogVersion: 999 },
    { name: 'segmented input', source: '$mode = "a"\n<Segmented value={$mode}><Option value="a">A</Option><Option value="b">B</Option></Segmented>' }
];
const fixtures = cases.map((fixture, index) => {
    const block = compileUiBlock(fixture.source, { id: `native-${index}`, final: fixture.final ?? true, querySchemas: { 'git.status': z.object({}) } });
    if (fixture.catalogVersion) {
        block.catalogVersion = fixture.catalogVersion;
    }
    if (block.complete) {
        block.revision = `parity-${index}`;
    }
    const request: NativeUiRequest = { block, queries: fixture.queries };
    return { name: fixture.name, request, result: evaluateNativeUi(request) };
});
const bundle = await Bun.build({
    entrypoints: [resolve(import.meta.dir, '../src/chat/native-ui-entry.ts')],
    target: 'browser',
    format: 'iife',
    minify: true,
    conditions: ['source']
});
if (!bundle.success) {
    throw new AggregateError(bundle.logs, 'Could not build the native UI interpreter');
}
const root = resolve(import.meta.dir, '../../ios/Packages/RuimteIntelligentUI');
function packageDirectory(name: string): string {
    let folder = dirname(createRequire(import.meta.url).resolve(name));
    while (true) {
        const manifest = resolve(folder, 'package.json');
        if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) {
            return folder;
        }
        const parent = dirname(folder);
        if (parent === folder) {
            throw new Error(`Could not find the license of ${name}`);
        }
        folder = parent;
    }
}
const licenses = await Promise.all(
    ['@adecore/intelligent-ui', 'zod'].map(async (name) => `${name}\n\n${await readFile(resolve(packageDirectory(name), 'LICENSE'), 'utf8')}`)
);
const outputs = new Map([
    [
        'Sources/RuimteIntelligentUI/Resources/intelligent-ui.js',
        '// Generated from the shared bounded interpreter by apps/server/scripts/generate-native-ui.ts.\n' + (await bundle.outputs[0]!.text())
    ],
    ['Tests/RuimteIntelligentUITests/Fixtures/parity.json', JSON.stringify(fixtures) + '\n'],
    ['Sources/RuimteIntelligentUI/Resources/licenses.txt', licenses.join('\n\n')]
]);
for (const [path, contents] of outputs) {
    const destination = resolve(root, path);
    if (process.argv.includes('--check')) {
        if ((await readFile(destination, 'utf8').catch(() => '')) !== contents) {
            throw new Error(`Stale generated file: ${destination}`);
        }
    } else {
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, contents);
    }
}
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Generated'} native UI interpreter and parity fixtures.`);
