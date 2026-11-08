import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileExists } from '@adecore/utils/fs';
import { MachineHome } from '../fs/machine-home.ts';
import { LanguageHost } from './host.ts';
import { eventually } from './test-integration.ts';
import { toolchainCandidates } from './toolchain.ts';

/*
 * A crate whose build script, proc macro and rustc wrapper each write a marker file, opened as the folder
 * of a worktree an agent works in. rust-analyzer and cargo must be on this machine; without them the suite skips.
 */

const fixtureRoot = process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT;
const hasToolchain =
    toolchainCandidates('rust-analyzer').some((path) => Bun.file(path).size > 0) && toolchainCandidates('cargo').some((path) => Bun.file(path).size > 0);

let base = '';
let project = '';
let host: LanguageHost;

function marker(name: string): Promise<boolean> {
    return fileExists(join(project, name));
}

async function write(path: string, text: string): Promise<void> {
    await mkdir(dirname(join(project, path)), { recursive: true });
    await writeFile(join(project, path), text);
}

beforeAll(async () => {
    if (!hasToolchain) {
        return;
    }

    base = await realpath(await mkdtemp(join(fixtureRoot ?? tmpdir(), 'ruimte-worktree-build-')));
    project = join(base, 'worktree');
    const wrapper = join(base, 'wrapper.sh');

    await writeFile(wrapper, `#!/bin/sh\nprintf ran > "${project}/marker-wrapper"\nexec "$@"\n`);
    await chmod(wrapper, 0o755);
    await write('Cargo.toml', '[workspace]\nmembers = ["app", "macros"]\nresolver = "2"\n');
    await write('.cargo/config.toml', `[build]\nrustc-wrapper = "${wrapper}"\n`);
    await write(
        'app/Cargo.toml',
        '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\nbuild = "build.rs"\n\n[dependencies]\nmacros = { path = "../macros" }\n'
    );
    await write('app/build.rs', 'fn main() {\n    std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/../marker-build"), "ran").unwrap();\n}\n');
    await write('app/src/main.rs', 'macros::touch!();\n\nfn main() {}\n');
    await write('macros/Cargo.toml', '[package]\nname = "macros"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\nproc-macro = true\n');
    await write(
        'macros/src/lib.rs',
        'use proc_macro::TokenStream;\n\n#[proc_macro]\npub fn touch(_: TokenStream) -> TokenStream {\n    std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/../marker-macro"), "ran").unwrap();\n    TokenStream::new()\n}\n'
    );

    host = new LanguageHost({
        root: join(base, 'home', 'language-servers'),
        folderOf: (projectId) => (projectId === 'p1' ? project : null),
        holders: () => ['c1'],
        machineHome: new MachineHome(join(base, 'home')),
        agentWorktrees: async () => ({ main: join(base, 'main'), paths: [project] })
    });
    await host.load();
    host.subscribe('c1', () => undefined);
}, 60_000);

afterAll(async () => {
    await host?.close();

    if (fixtureRoot === undefined && base !== '') {
        await rm(base, { recursive: true, force: true });
    }
});

async function rustState(): Promise<string | undefined> {
    return (await host.status('p1')).find((status) => status.server === 'rust')?.state;
}

describe.skipIf(!hasToolchain)('rust-analyzer in the worktree of an agent', () => {
    test('runs no build script, proc macro or compiler wrapper until a person turns it on', async () => {
        await host.install('rust');
        await eventually('rust-analyzer found', rustState, (state) => state === 'stopped');
        await host.open('c1', { projectId: 'p1', path: 'app/src/main.rs', languageId: 'rust', text: 'macros::touch!();\n\nfn main() {}\n' });
        await eventually('rust-analyzer ready', rustState, (state) => state === 'ready', 120_000);
        // A request that needs the project loaded, so the load that would run them has ended.
        await eventually(
            'symbols',
            () => host.request({ projectId: 'p1', path: 'app/src/main.rs', method: 'textDocument/documentSymbol', params: {} }),
            (answer) => Array.isArray(answer.result) && answer.result.length > 0,
            120_000
        );
        await Bun.sleep(3000);

        expect(await marker('marker-build')).toBe(false);
        expect(await marker('marker-macro')).toBe(false);
        expect(await marker('marker-wrapper')).toBe(false);

        await host.setWorktreeBuild('p1', true);

        await eventually('build script ran', () => marker('marker-build'), Boolean, 180_000);
        await eventually('proc macro ran', () => marker('marker-macro'), Boolean, 180_000);
    }, 600_000);
});
