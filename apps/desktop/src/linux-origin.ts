import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkoutOrigin, type LinuxArch, type MachineOrigin } from '@ruimte/devcontainer';
import type { RunProgram } from './program-run';

/* Gets Ruimte for Linux onto this computer before the steps, which the shell does itself rather than through a program. */
export interface OriginFetch {
    title: string;
    /* What it does, as a person reads it before saying yes: the package and the digest npm states for it. */
    command: string;
    cwd: string;
    /* Throws the reason it could not. */
    run(hooks: { line(text: string): void; signal: AbortSignal }): Promise<void>;
}

export interface ShellOrigin {
    origin: MachineOrigin;
    fetch: OriginFetch | null;
}

export type OriginAnswer = { ok: true; value: ShellOrigin } | { ok: false; reason: string };

export const REGISTRY = 'https://registry.npmjs.org';

/* The platform package of the version that runs, as `packages/npm` publishes it. */
export function packageName(arch: LinuxArch): string {
    return `@ruimte/linux-${arch}`;
}

/* From a checkout, which builds the daemon it holds for Linux on every start, as the Dev Containers extension does. */
export function checkoutShellOrigin(arch: LinuxArch, checkout: string): OriginAnswer {
    const origin = checkoutOrigin(arch, checkout);

    return origin === null ? { ok: false, reason: 'This checkout has no folder.' } : { ok: true, value: { origin, fetch: null } };
}

export interface NpmOriginOptions {
    version: string;
    arch: LinuxArch;
    /* The app's own folder for what it downloads, under `userData`. */
    root: string;
    fetch: typeof fetch;
    /* Unpacks the package, with `tar`, which macOS and Linux both have. */
    run: RunProgram;
    env: Record<string, string | undefined>;
}

interface Published {
    tarball: string;
    integrity: string;
}

function publishedOf(answer: unknown): Published | null {
    const dist = (answer as { dist?: { tarball?: unknown; integrity?: unknown } } | null)?.dist;

    if (typeof dist?.tarball !== 'string' || typeof dist.integrity !== 'string' || !dist.integrity.startsWith('sha512-')) {
        return null;
    }

    return { tarball: dist.tarball, integrity: dist.integrity };
}

function megabytes(bytes: number): string {
    return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

/*
 * The published platform package of the version that runs, which holds the daemon of the same release. It is asked of
 * npm when a start is described, downloaded once into the app's own folder, held to the digest npm states for it, and
 * the container gets its `bin` folder read only. A version npm has no package for ends there, before anything runs.
 */
export async function npmOrigin(options: NpmOriginOptions): Promise<OriginAnswer> {
    const name = packageName(options.arch);
    let response: Response;

    try {
        response = await options.fetch(`${REGISTRY}/${name}/${encodeURIComponent(options.version)}`, { headers: { accept: 'application/json' } });
    } catch {
        return { ok: false, reason: `Ruimte could not reach npm to get Ruimte for Linux ${options.version}. Check your connection and try again.` };
    }

    if (response.status === 404) {
        return {
            ok: false,
            reason: `Ruimte ${options.version} has no Ruimte for Linux on npm, so it cannot put a machine in a container. Update Ruimte and try again.`
        };
    }

    const published = response.ok ? publishedOf(await response.json().catch(() => null)) : null;

    if (published === null) {
        return { ok: false, reason: `npm did not say where Ruimte for Linux ${options.version} is. Try again later.` };
    }

    const folder = join(options.root, `${options.version}-linux-${options.arch}`);
    const bin = join(folder, 'package', 'bin');

    return {
        ok: true,
        value: {
            origin: { step: null, folder: bin },
            fetch: {
                title: `Get Ruimte for Linux ${options.version} from npm, unless it is here already`,
                command: `${name}@${options.version} from ${published.tarball}, checked against ${published.integrity}`,
                cwd: options.root,
                run: (hooks) => place(options, published, folder, hooks)
            }
        }
    };
}

async function place(options: NpmOriginOptions, published: Published, folder: string, hooks: { line(text: string): void; signal: AbortSignal }): Promise<void> {
    const marker = join(folder, '.integrity');
    const kept = await readFile(marker, 'utf8').catch(() => null);

    if (kept === published.integrity && existsSync(join(folder, 'package', 'bin', 'ruimte'))) {
        hooks.line('Ruimte for Linux is here already');

        return;
    }

    hooks.line(`Downloading ${published.tarball}`);

    const response = await options.fetch(published.tarball, { signal: hooks.signal });

    if (!response.ok) {
        throw new Error(`npm answered ${response.status} for ${published.tarball}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== published.integrity) {
        throw new Error('The download does not match what npm states for it, so Ruimte did not use it.');
    }

    hooks.line(`Downloaded ${megabytes(bytes.length)}, as npm states it`);

    const staging = `${folder}.staging`;
    const archive = `${folder}.tgz`;

    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await writeFile(archive, bytes);

    try {
        const code = await options.run(
            { command: 'tar', args: ['-xzf', archive, '-C', staging], cwd: options.root, env: options.env },
            { line: (text) => hooks.line(text), signal: hooks.signal }
        );

        if (code !== 0) {
            throw new Error(`tar could not unpack ${archive}`);
        }

        if (!existsSync(join(staging, 'package', 'bin', 'ruimte'))) {
            throw new Error(`${packageName(options.arch)}@${options.version} holds no Ruimte for Linux.`);
        }

        await rm(folder, { recursive: true, force: true });
        await rename(staging, folder);
        await writeFile(marker, published.integrity);
    } finally {
        await rm(archive, { force: true });
        await rm(staging, { recursive: true, force: true });
    }
}
