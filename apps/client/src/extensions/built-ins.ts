import type { ExtensionManifest, ExtensionTheme } from '@ruimte/contracts';
import type { LucideIcon } from 'lucide-react';
import { z } from 'zod';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { useInstalledExtensions } from '@/extensions/installed';
import { extensionsInSafeMode } from '@/extensions/safe-mode';
import { contribute } from '@/state/extension-registry';
import { storedJson } from '@/state/stored-json';

type Loads = typeof import('@/extensions/host/loads');

/* A theme a built-in brings, read from its pack with the client's own build rather than fetched. */
export interface BuiltInTheme {
    // As its manifest's `themes` names it.
    path: string;
    theme: ExtensionTheme;
    thumbnailUrl: string;
}

/*
 * An extension shipped inside the client: its manifest, its words and themes, and its `client/index.ts` imported with
 * `?activate` (`built-ins.ts` at the client's root). It runs on the public API alone, loaded as an installed extension
 * is, so turning it off takes out everything it defined and turning it on runs its entry anew.
 */
export interface BuiltIn {
    manifest: ExtensionManifest;
    icon?: string | LucideIcon;
    activate?: () => Promise<{ default: () => void }>;
    words?: Readonly<Record<string, () => Promise<{ default: object }>>>;
    themes?: readonly BuiltInTheme[];
}

export const BUILT_INS_DISABLED_KEY = 'ruimte.builtIns.disabled';

const disabledBuiltIns = storedJson<string[]>(BUILT_INS_DISABLED_KEY, z.array(z.string()));
const followers = new Map<string, (enabled: boolean) => void>();
// One import of the loads, so a stop asked before a start always settles before it.
let loads: Promise<Loads> | null = null;
// Counts the starts and stops of each built-in, so a start that a stop overtook does nothing once it resumes.
const runs = new Map<string, number>();

export function readDisabled(): string[] {
    return disabledBuiltIns.read() ?? [];
}

function writeDisabled(id: string, disabled: boolean): void {
    const rest = readDisabled().filter((entry) => entry !== id);

    disabledBuiltIns.write(disabled ? [...rest, id] : rest);
}

function loadsModule(): Promise<Loads> {
    loads ??= import('@/extensions/host/loads');

    return loads;
}

function nextRun(id: string): number {
    const run = (runs.get(id) ?? 0) + 1;

    runs.set(id, run);

    return run;
}

async function start(builtIn: BuiltIn, activate: NonNullable<BuiltIn['activate']>): Promise<void> {
    const { id } = builtIn.manifest;
    const run = nextRun(id);
    const { registerExtension, forgetExtension } = await loadsModule();

    if (runs.get(id) !== run) {
        return;
    }

    const extension: LoadedExtension = {
        manifest: builtIn.manifest,
        base: '',
        iconUrl: typeof builtIn.icon === 'string' ? builtIn.icon : null,
        disposers: [],
        settings: null,
        builtIn: true,
        ...(builtIn.words === undefined ? {} : { words: builtIn.words })
    };
    const current = registerExtension(extension);

    try {
        const entry = await activate();

        if (current()) {
            entry.default();
            useInstalledExtensions.setState(({ failures: { [id]: _cleared, ...failures } }) => ({ failures }));
        }
    } catch (e) {
        if (!current()) {
            return;
        }

        forgetExtension(id);
        useInstalledExtensions.setState((state) => ({ failures: { ...state.failures, [id]: e instanceof Error ? e.message : String(e) } }));
    }
}

async function stop(id: string): Promise<void> {
    nextRun(id);
    (await loadsModule()).forgetExtension(id);
}

/*
 * What a built-in adds while it is on. Its themes are data the host offers; its entry is code that runs on the API.
 * Safe mode runs no built-in either, so a person can still turn one off that hangs the app.
 */
function followerOf(builtIn: BuiltIn): (enabled: boolean) => void {
    const { id } = builtIn.manifest;
    let disposers: (() => void)[] | null = null;

    return (enabled) => {
        const wanted = enabled && !extensionsInSafeMode();

        if (wanted === (disposers !== null)) {
            return;
        }

        disposers?.forEach((dispose) => dispose());
        disposers = null;

        if (!wanted) {
            if (builtIn.activate !== undefined) {
                void stop(id);
            }

            return;
        }

        disposers = (builtIn.themes ?? []).map(({ path, theme, thumbnailUrl }) =>
            contribute('builtInThemes', { id: `${id}/${path}`, extensionId: id, theme, thumbnailUrl })
        );

        if (builtIn.activate !== undefined) {
            void start(builtIn, builtIn.activate);
        }
    };
}

/*
 * Names a built-in to Settings, where a person turns it on or off, and runs it while it is on. The client never takes
 * one out again; a test does, with what this answers.
 */
export function defineBuiltIn(builtIn: BuiltIn): () => void {
    const { id } = builtIn.manifest;
    const follow = followerOf(builtIn);
    const takeOut = contribute('builtIns', {
        id,
        manifest: builtIn.manifest,
        setEnabled: (enabled) => {
            follow(enabled);
            writeDisabled(id, !enabled);
        },
        ...(builtIn.icon === undefined ? {} : { icon: builtIn.icon })
    });
    followers.set(id, follow);
    follow(!readDisabled().includes(id));

    return () => {
        follow(false);
        followers.delete(id);
        takeOut();
    };
}

/* Another window turned a built-in on or off; this one follows without writing the list back. */
export function followDisabledBuiltIns(): void {
    const disabled = readDisabled();

    for (const [id, follow] of followers) {
        follow(!disabled.includes(id));
    }
}
