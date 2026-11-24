import { existsSync, readdirSync, watch } from 'node:fs';
import { join } from 'node:path';
import { EXTENSION_LINK_PATH } from '@ruimte/contracts';
import { DEV_PORT, devRuimteHome } from '@ruimte/service/runtime';
import { oneAtATime, watchAndBuild } from '../src/cli/extension.ts';
import { askLocalDaemon, homeSecret } from '../src/cli/local-daemon.ts';
import { buildExtension } from '../src/extensions/pack.ts';
import { DEVELOPMENT_EXTENSION_FOLDERS } from '../src/extensions/provenance.ts';

/*
 * Puts Ruimte's development extensions into the development daemon, as `ruimte extension dev` would one by one: each is
 * built into its own `dist` and linked over the daemon's link route, and built and linked again on a save. Only
 * `scripts/dev.ts` starts this, so an installed Ruimte and a build never meet them. A link stays when `bun dev` ends,
 * since the development home is theirs alone; a folder added while it runs is linked at the next start.
 */

// Off until a person turns them on in Settings: they break on purpose.
const STARTS_OFF: readonly string[] = ['extensions/poc/broken', 'extensions/poc/broken-load'];
// The probe of the contract suite offers every agent a tool and has nothing to look at.
const NOT_LINKED: readonly string[] = ['extensions/poc/contract'];
const WATCH_DEBOUNCE_MS = 150;
const DAEMON_POLL_MS = 500;
// A daemon that restarts on a save of its own answers again within seconds; past this the link waits for the next save.
const DAEMON_WAIT_MS = 120_000;

export interface DevelopmentExtension {
    /* From the repository's root, with `/` on every platform. */
    path: string;
    startsOff: boolean;
}

/* Every folder with a manifest under the development folders, in the order of their names. */
export function developmentExtensions(repository: string): DevelopmentExtension[] {
    return DEVELOPMENT_EXTENSION_FOLDERS.flatMap((parent) => {
        const folder = join(repository, parent);

        if (!existsSync(folder)) {
            return [];
        }

        return readdirSync(folder)
            .toSorted()
            .filter((name) => existsSync(join(folder, name, 'manifest.json')))
            .map((name) => ({ path: `${parent}/${name}`, startsOff: STARTS_OFF.includes(`${parent}/${name}`) }));
    });
}

export interface DevLinkDeps {
    repository: string;
    extensions: readonly DevelopmentExtension[];
    /* Builds a folder and answers where the build is. */
    build(folder: string): Promise<string>;
    link(folder: string, startsOff: boolean): Promise<void>;
    /* Tells of every change under a folder of development extensions, by its path from that folder. */
    watch(folder: string, listener: (name: string | null) => void): void;
    debounce(key: string, run: () => void): void;
    failed(path: string, error: unknown): void;
}

/*
 * Builds and links each, and again for a save in its folder. One that fails to build or link says so and leaves the
 * others alone; its next save tries again.
 */
export async function linkDevelopmentExtensions(deps: DevLinkDeps): Promise<void> {
    const saves = new Map<string, (name: string | null) => void>();

    for (const parent of DEVELOPMENT_EXTENSION_FOLDERS) {
        deps.watch(join(deps.repository, parent), (name) => {
            const [extension, ...rest] = (name ?? '').split(/[\\/]/);

            saves.get(`${parent}/${extension}`)?.(rest.length === 0 ? null : rest.join('/'));
        });
    }

    await Promise.all(
        deps.extensions
            .filter((extension) => !NOT_LINKED.includes(extension.path))
            .map(({ path, startsOff }) => {
                const folder = join(deps.repository, path);

                return watchAndBuild({
                    folder,
                    rebuild: oneAtATime(async () => {
                        try {
                            await deps.link(await deps.build(folder), startsOff);
                        } catch (e) {
                            deps.failed(path, e);
                        }
                    }),
                    watch: (listener) => void saves.set(path, listener),
                    debounce: (run) => deps.debounce(path, run)
                });
            })
    );
}

/* Asks the development daemon to link a build, waiting while it starts or restarts. */
async function linkOnDaemon(folder: string, startsOff: boolean): Promise<void> {
    const options = { port: DEV_PORT, home: devRuimteHome() };
    const deadline = Date.now() + DAEMON_WAIT_MS;

    for (;;) {
        // Read each time: a first start writes the secret only once the daemon is up.
        const secret = await homeSecret(options);
        const response = secret === null ? null : await askLocalDaemon(options, secret, EXTENSION_LINK_PATH, { method: 'POST', body: { folder, startsOff } });

        if (response?.ok === true) {
            return;
        }

        if (response !== null) {
            const answer = (await response.json().catch(() => ({}))) as { message?: unknown };

            throw new Error(typeof answer.message === 'string' ? answer.message : `The development daemon answered ${response.status}`);
        }

        if (Date.now() > deadline) {
            throw new Error(`No development daemon answered on port ${DEV_PORT}`);
        }

        await Bun.sleep(DAEMON_POLL_MS);
    }
}

if (import.meta.main) {
    const repository = join(import.meta.dir, '..', '..', '..');
    const extensions = developmentExtensions(repository);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    await linkDevelopmentExtensions({
        repository,
        extensions,
        build: async (folder) => (await buildExtension(folder)).outdir,
        link: linkOnDaemon,
        watch: (folder, listener) => {
            if (existsSync(folder)) {
                watch(folder, { recursive: true }, (_event, name) => listener(name));
            }
        },
        debounce: (key, run) => {
            clearTimeout(timers.get(key));
            timers.set(key, setTimeout(run, WATCH_DEBOUNCE_MS));
        },
        failed: (path, e) => console.error(`${path} is not loaded: ${e instanceof Error ? e.message : String(e)}`)
    });
    console.log(`Linked the development extensions of ${DEVELOPMENT_EXTENSION_FOLDERS.join(' and ')}. A save builds and loads one again.`);
    await new Promise(() => undefined);
}
