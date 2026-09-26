import { copyFile, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Glob } from 'bun';
import { LIBRARIES, libraryManifest, type Library } from '../src/libraries';

/*
 * Lays out the libraries that go to npm beside `ruimte`, each ready for `npm publish` in its folder:
 *
 *   bun scripts/build-libraries.ts --version 0.7.0 --out <dir>
 *
 * The workspace reads these packages as TypeScript source; npm gets JavaScript with declarations.
 * Each one compiles against the declarations of the ones before it, so a package never carries a
 * copy of another. Only the library folders in `--out` are replaced, so it runs after `build.ts`.
 */
const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
        version: { type: 'string' },
        out: { type: 'string' }
    },
    strict: true
});

if (!values.version || !values.out) {
    console.error('Usage: bun scripts/build-libraries.ts --version <version> --out <dir>');
    process.exit(1);
}

const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const out = resolve(values.out);
const version = values.version;

const writeJson = (path: string, value: unknown): Promise<void> => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

/* Where a library that depends on another finds its declarations instead of its source. */
const declarationPaths = (): Record<string, string[]> =>
    Object.fromEntries(
        LIBRARIES.flatMap((library) => [
            [`@ruimte/${library}`, [join(out, library, 'dist', 'index.d.ts')]],
            [`@ruimte/${library}/*`, [join(out, library, 'dist', '*')]]
        ])
    );

const build = async (library: Library): Promise<void> => {
    const source = join(repoRoot, 'packages', library);
    const dir = join(out, library);
    const dist = join(dir, 'dist');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dist, { recursive: true });

    // Beside the package's own tsconfig, since `types` and the modules it names resolve from there.
    const tsconfig = join(source, 'tsconfig.publish.json');
    await writeJson(tsconfig, {
        extends: join(source, 'tsconfig.json'),
        compilerOptions: {
            noEmit: false,
            declaration: true,
            rewriteRelativeImportExtensions: true,
            rootDir: join(source, 'src'),
            outDir: dist,
            paths: declarationPaths()
        },
        include: [join(source, 'src')],
        exclude: [join(source, 'src', '**', '*.test.ts')]
    });
    const compiled = Bun.spawnSync(['bunx', 'tsc', '-p', tsconfig], { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit' });
    await rm(tsconfig, { force: true });
    if (compiled.exitCode !== 0) {
        console.error(`Compiling ${library} failed.`);
        process.exit(1);
    }

    // Stylesheets, translations, model lists and the fixtures of the fake CLIs, which tsc does not carry.
    for (const path of new Glob('**/*').scanSync(join(source, 'src'))) {
        if (/\.(tsx?)$/.test(path)) {
            continue;
        }
        await mkdir(dirname(join(dist, path)), { recursive: true });
        await copyFile(join(source, 'src', path), join(dist, path));
    }

    // The next library compiles against these declarations, which import this one's dependencies; the
    // workspace installs those per package, so they resolve through a link that goes before publishing.
    await symlink(join(source, 'node_modules'), join(dir, 'node_modules'), 'dir');

    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
    await writeJson(join(dir, 'package.json'), libraryManifest(library, manifest, version));
    await copyFile(join(source, 'README.md'), join(dir, 'README.md'));
    await copyFile(join(repoRoot, 'LICENSE'), join(dir, 'LICENSE'));
    console.log(`Laid out ${dir}`);
};

for (const library of LIBRARIES) {
    await build(library);
}
for (const library of LIBRARIES) {
    await rm(join(out, library, 'node_modules'), { force: true });
}
