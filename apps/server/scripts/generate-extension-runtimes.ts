/*
 * Bundles what an extension's own process runs, and what `ruimte extension test` preloads, each into one file the daemon
 * carries as text: a compiled daemon has no source tree to import from. `--check` fails on a stale one.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const SOURCE = join(import.meta.dir, '..', 'src', 'extensions');
const BUNDLES = [{ entry: 'server-runtime.ts', output: 'generated/server-runtime.js' }];
const PRAGMA = '// @bun\n';

// The bundle names each module by its path from here, so the output is the same from whichever folder this runs.
process.chdir(join(import.meta.dir, '..', '..', '..'));

async function bundled(entry: string): Promise<string> {
    const build = await Bun.build({ entrypoints: [join(SOURCE, entry)], target: 'bun', format: 'esm' });
    const [output] = build.outputs;

    if (!build.success || output === undefined) {
        throw new Error(`${entry} did not bundle: ${build.logs.join('\n')}`);
    }

    const text = await output.text();
    const header = `// Generated from apps/server/src/extensions/${entry} by apps/server/scripts/generate-extension-runtimes.ts. Do not edit.\n`;

    // The pragma stays first, where Bun reads it.
    return text.startsWith(PRAGMA) ? `${PRAGMA}${header}${text.slice(PRAGMA.length)}` : `${header}${text}`;
}

const check = process.argv.includes('--check');

for (const { entry, output } of BUNDLES) {
    const destination = join(SOURCE, output);
    const contents = await bundled(entry);

    if (!check) {
        await writeFile(destination, contents);
    } else if ((await readFile(destination, 'utf8').catch(() => '')) !== contents) {
        throw new Error(`Stale generated file: ${relative(process.cwd(), destination)}. Run bun apps/server/scripts/generate-extension-runtimes.ts`);
    }
}

console.log(`${check ? 'Checked' : 'Generated'} the extension runtimes.`);
