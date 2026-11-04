import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import * as intelligentUi from '@adecore/intelligent-ui';
import { compileUiBlock, type UiBlock, type UiViewNode } from '@adecore/intelligent-ui';
import { z } from 'zod';
import { evaluateNativeUi, type NativeUiRequest } from '../src/chat/native-ui';

interface ParityCase {
    name: string;
    source: string;
    queries?: Record<string, unknown>;
    final?: boolean;
    catalogVersion?: number;
    // The input a person gave, addressed by the type of the node it went to, since node ids follow the source.
    values?: Record<string, unknown>;
    change?: { type: string; value: unknown };
    action?: { type: string; index?: number };
}

const cases: ParityCase[] = [
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
    {
        name: 'values and change',
        source: '$count = 2\n$picked = ["a"]\n<Slider value={$count} min={0} max={10}>Count</Slider><Checklist value={$picked}><Item value="a">A</Item><Item value="b">B</Item></Checklist><Summary>{$count} and {@Count($picked)}</Summary>',
        values: { $count: 4, $picked: ['a'] },
        change: { type: 'Checklist', value: ['a', 'b'] }
    },
    {
        name: 'button action',
        source: '$mode = "a"\n<Button action={@Set($mode, "b")}>Use B</Button><Button action={@Reset()}>Start over</Button><Summary>Mode {$mode}</Summary>',
        action: { type: 'Button' }
    },
    {
        name: 'button reset',
        source: '$mode = "a"\n<Button action={@Set($mode, "b")}>Use B</Button><Button action={@Reset($mode)}>Start over</Button><Summary>Mode {$mode}</Summary>',
        values: { $mode: 'b' },
        action: { type: 'Button', index: 1 }
    },
    {
        name: 'derived table',
        source: '<Table rows={[{name:"a", size:3, when:"2026-01-02"}, {zeta:1, name:"b", size:"4"}, {extra:null}]}/>'
    },
    {
        name: 'declared table',
        source: '<Table rows={[{name:"a", size:3}, {name:"b", size:"x"}]}><Column key="size" title="Size" unit="KB" as="number"/><Column key="name"/><Column key="name"/><Column key="missing"/></Table>'
    },
    { name: 'bar chart', source: '<Chart kind="bar" data={[{label:"a", zeta:1, alpha:"x"}, {label:2, alpha:-2, zeta:3}, {beta:4}]}/>' },
    { name: 'stacked chart', source: '<Chart kind="stacked" unit="ms" data={[{label:"a", x:1, y:-2}, {label:"b", x:3, y:4}]}/>' },
    { name: 'negative hbar', source: '<Chart kind="hbar" data={[{label:"Core", value:-3}, {label:"Client", value:5}]}/>' },
    { name: 'seven series', source: '<Chart kind="bar" data={[{label:"t", a:1, b:2, c:3, d:4, e:5, f:6, g:7}]}/>' },
    { name: 'too large to scale', source: '<Chart kind="bar" data={[{label:"Huge", count:1.5e308}]}/>' },
    {
        name: 'choice eligibility',
        source: '$empty = ""\n<Choices><Choice context="Run checks">Run {$missing}</Choice><Choice>{$empty}</Choice><Choice context=bad>Fix</Choice ><Choice> Run   checks </Choice></Choices>'
    },
    { name: 'nine derived columns', source: '<Table rows={[{a:1, b:2, c:3, d:4, e:5, f:6, g:7, h:8, i:9}]}/>' },
    {
        name: 'live input',
        source: '$limit = 1\n$zeta = @Query("git.status", {})\n$alpha = @Query("git.status", {})\n<Slider value={$limit} min={0} max={5}>Limit</Slider><Stats><Stat label="Files" value={@Count($zeta.files) + @Count($alpha.files)}/></Stats>',
        queries: { $zeta: { files: ['a'] }, $alpha: { files: [] } }
    },
    {
        name: 'timeline',
        source: '<Timeline><Event at="14:02" tone="warning" detail="p95 above 2 s">Alert fired</Event><Event at="2026-10-14T12:20:00Z">Recovered</Event><Event at="after lunch">Unreadable time</Event></Timeline>'
    },
    { name: 'gallery', source: '<Gallery><Image attachment="shot-1">Login</Image><Image attachment="shot-2" alt="Settings"/></Gallery>' },
    { name: 'compare', source: '<Compare before="shot-1" after="shot-2" beforeLabel="Old">Header spacing</Compare>' },
    {
        name: 'text field',
        source: '$name = "Ada"\n<TextField value={$name} maxLength={5} placeholder="Name">Your name</TextField><Summary>Hello {$name}</Summary>'
    },
    {
        name: 'select input',
        source: '$mode = "a"\n<Select value={$mode}><Option value="a">Alpha</Option><Option value="b">Beta</Option>Mode</Select><Summary>Mode {$mode}</Summary>'
    },
    {
        name: 'map',
        source: '$picked = "dom"\n<Map value={$picked}><Place lat={52.0907} lon={5.1214} value="dom" detail="Cathedral tower">Domtoren</Place><Place lat={52.3676} lon={4.9041} value="ams">Amsterdam</Place><Place address="Oudegracht 1, Utrecht" value="gracht">Canal house</Place></Map>'
    },
    { name: 'model', source: '<Model attachment="att-bracket" alt="Bracket">A printed bracket</Model>' },
    { name: 'segmented input', source: '$mode = "a"\n<Segmented value={$mode}><Option value="a">A</Option><Option value="b">B</Option></Segmented>' }
];

function nodesOfType(block: UiBlock, type: string): string[] {
    const ids: string[] = [];
    const visit = (nodes: UiBlock['nodes']) => {
        for (const node of nodes) {
            if (node.type === type) {
                ids.push(node.id);
            }
            visit(node.children);
        }
    };
    visit(block.nodes);
    return ids;
}

const fixtures = cases.map((fixture, index) => {
    const block = compileUiBlock(fixture.source, { id: `native-${index}`, final: fixture.final ?? true, querySchemas: { 'git.status': z.object({}) } });
    if (fixture.catalogVersion) {
        block.catalogVersion = fixture.catalogVersion;
    }
    if (block.complete) {
        block.revision = `parity-${index}`;
    }
    const request: NativeUiRequest = { block, queries: fixture.queries, values: fixture.values };
    if (fixture.change) {
        request.change = { nodeId: nodesOfType(block, fixture.change.type)[0]!, prop: 'value', value: fixture.change.value };
    }
    if (fixture.action) {
        request.action = { nodeId: nodesOfType(block, fixture.action.type)[fixture.action.index ?? 0]! };
    }
    return { name: fixture.name, request, result: evaluateNativeUi(request) };
});

const ruimte = resolve(import.meta.dir, '../../..');

function packageDirectory(name: string, from = import.meta.url, entry = name): string {
    let folder = dirname(createRequire(from).resolve(entry));
    while (true) {
        const manifest = resolve(folder, 'package.json');
        if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) {
            return folder;
        }
        const parent = dirname(folder);
        if (parent === folder) {
            throw new Error(`Could not find the package folder of ${name}`);
        }
        folder = parent;
    }
}

// The desktop's own table, chart and label rules, which the hand-ported Swift in the app is checked against.
const agentsReact = packageDirectory('@adecore/agents-react', resolve(ruimte, 'apps/client/package.json'), '@adecore/agents-react/chat/ui');
const exportsOf = JSON.parse(readFileSync(resolve(agentsReact, 'package.json'), 'utf8')).exports as Record<string, { source: string }>;
const { uiChartData, uiNodeLabel, uiTableColumns } = await import(resolve(agentsReact, exportsOf['./chat/ui']!.source));
// Which choices a page may offer; the expectation exists once the shared package has the rule, so an older one only leaves the fixture stale.
const uiChoiceLabel = (intelligentUi as Record<string, unknown>).uiChoiceLabel as ((choice: UiViewNode) => string | null) | undefined;
const presentation = fixtures
    .filter((fixture) => {
        const block = fixture.request.block as ReturnType<typeof compileUiBlock>;
        return block.complete && block.catalogVersion !== 999;
    })
    .map(({ name, result }) => {
        const expected: Record<string, unknown> = {};
        const visit = (nodes: readonly UiViewNode[]) => {
            for (const node of nodes) {
                if (!node.error && node.type !== '$text') {
                    expected[node.id] = {
                        label: uiNodeLabel(node),
                        ...(node.type === 'Table' ? { columns: uiTableColumns(node) } : {}),
                        ...(node.type === 'Chart' ? { chart: uiChartData(node.props.data, node.props.kind) } : {}),
                        ...(node.type === 'Choice' && uiChoiceLabel !== undefined ? { choiceLabel: uiChoiceLabel(node) } : {})
                    };
                }
                visit(node.children);
            }
        };
        visit(result.nodes as UiViewNode[]);
        return { name, nodes: result.nodes, expected };
    });

const bundle = await Bun.build({
    entrypoints: [resolve(import.meta.dir, '../src/chat/native-ui-entry.ts')],
    target: 'browser',
    format: 'iife',
    minify: true,
    conditions: ['source'],
    metafile: true
});
if (!bundle.success) {
    throw new AggregateError(bundle.logs, 'Could not build the native UI interpreter');
}

/* The package a bundled file belongs to and its place there, so the digest does not depend on where packages are installed or linked. */
function sourceName(path: string): readonly [name: string, contents: string] {
    const normalizedPath = path.replaceAll('\\', '/');
    let folder = dirname(path);
    while (dirname(folder) !== folder) {
        const manifest = resolve(folder, 'package.json');
        // Packages such as zod carry a nameless package.json per subpath, which only sets the module type.
        const { name, version } = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : {};
        if (name) {
            // Which files of a third-party package a bundle lists differs between Bun versions, its version does not.
            if (normalizedPath.includes('/node_modules/') && !name.startsWith('@adecore/')) {
                return [`${name}@${version}`, ''];
            }
            return [`${name}/${relative(folder, path).replaceAll('\\', '/')}`, readFileSync(path, 'utf8')];
        }
        folder = dirname(folder);
    }
    return [normalizedPath, readFileSync(path, 'utf8')];
}

// Minified output differs between Bun versions, so a check compares what went in rather than the bytes that came out.
const sources = [...new Map(Object.keys(bundle.metafile!.inputs).map((input) => sourceName(resolve(process.cwd(), input))))].sort(([left], [right]) =>
    left.localeCompare(right)
);
const digest = createHash('sha256');
for (const [name, contents] of sources) {
    digest.update(`${name}\0${contents}\0`);
}
const header = `// Generated from the shared bounded interpreter by apps/server/scripts/generate-native-ui.ts.\n// Sources: ${digest.digest('hex')}\n`;
const root = resolve(ruimte, 'apps/ios/Packages/RuimteIntelligentUI');
const licenses = await Promise.all(
    ['@adecore/intelligent-ui', 'zod'].map(async (name) => `${name}\n\n${await readFile(resolve(packageDirectory(name), 'LICENSE'), 'utf8')}`)
);
const bundlePath = resolve(root, 'Sources/RuimteIntelligentUI/Resources/intelligent-ui.js');
const outputs = new Map([
    [resolve(root, 'Tests/RuimteIntelligentUITests/Fixtures/parity.json'), JSON.stringify(fixtures) + '\n'],
    [resolve(root, 'Sources/RuimteIntelligentUI/Resources/licenses.txt'), licenses.join('\n\n')],
    [resolve(ruimte, 'apps/ios/Tests/Fixtures/intelligent-ui-presentation.json'), JSON.stringify(presentation) + '\n']
]);
if (process.argv.includes('--check')) {
    const current = await readFile(bundlePath, 'utf8').catch(() => '');
    if (!current.startsWith(header)) {
        throw new Error(`Stale generated file: ${bundlePath}`);
    }
    for (const [destination, contents] of outputs) {
        if ((await readFile(destination, 'utf8').catch(() => '')) !== contents) {
            throw new Error(`Stale generated file: ${destination}`);
        }
    }
} else {
    outputs.set(bundlePath, header + (await bundle.outputs[0]!.text()));
    for (const [destination, contents] of outputs) {
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, contents);
    }
}
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Generated'} native UI interpreter and parity fixtures.`);
