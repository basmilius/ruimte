import { lstat, mkdir, readdir, readlink, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isNotFound } from '@ruimte/agents/fs';

/*
 * A Codex shadow home: a folder of its own for one login, sharing everything else with a Codex home
 * by symlink, so two accounts continue each other's threads. Codex needs its login in `auth.json`
 * (`cli_auth_credentials_store = "file"`) for this; a login in the keychain has no folder to be in.
 */

/* Made in the shared home before anything is linked, so the first thread of either account already lands there. */
const SHARED_FOLDERS = ['sessions', 'archived_sessions', 'skills', 'rules'];

/* The login, which is the whole point of the shadow home. */
const PRIVATE_ENTRIES = new Set(['auth.json']);

/*
 * What one Codex process keeps for itself: what the models of this login are, caches, logs, and the
 * sockets of an app-server that answers for the account that started it.
 */
const LOCAL_ENTRIES = new Set(['models_cache.json', 'cache', 'log', 'logs', 'tmp', '.tmp', 'app-server-daemon', 'app-server-control', 'ipc']);

/* A SQLite journal comes and goes with its database, so a link to one would soon point at nothing. */
const isJournal = (name: string): boolean => /-(wal|shm|journal)$/.test(name);

export interface ShadowHomeReport {
    linked: string[];
    // Entries of the shadow home in the way of a link: a real file or a link somewhere else. Left alone.
    unshared: string[];
    // A private entry that is a link, so this account would sign in as another one.
    sharedLogin: boolean;
}

export class ShadowHomeError extends Error {}

type Existing = { kind: 'missing' } | { kind: 'link'; target: string } | { kind: 'real' };

const existing = async (path: string): Promise<Existing> => {
    try {
        const stats = await lstat(path);
        return stats.isSymbolicLink() ? { kind: 'link', target: await readlink(path) } : { kind: 'real' };
    } catch (e) {
        if (isNotFound(e)) {
            return { kind: 'missing' };
        }
        throw e;
    }
};

/*
 * Links every shared entry of `home` into `shadow` that is not there yet. Never overwrites and never
 * removes anything, so it runs again whenever it likes and picks up what Codex added to `home` since.
 * Both folders have to exist; the person makes them, the way they sign in.
 */
export const prepareShadowHome = async (home: string, shadow: string): Promise<ShadowHomeReport> => {
    const shared = resolve(home);
    const own = resolve(shadow);
    if (shared === own) {
        throw new ShadowHomeError('The shadow home has to be another folder than the config folder');
    }
    for (const folder of SHARED_FOLDERS) {
        await mkdir(join(shared, folder), { recursive: true });
    }
    const report: ShadowHomeReport = { linked: [], unshared: [], sharedLogin: false };
    for (const name of PRIVATE_ENTRIES) {
        if ((await existing(join(own, name))).kind === 'link') {
            report.sharedLogin = true;
        }
    }
    const names = (await readdir(shared)).filter((name) => !PRIVATE_ENTRIES.has(name) && !LOCAL_ENTRIES.has(name) && !isJournal(name));
    for (const name of names.sort()) {
        const target = join(shared, name);
        const link = join(own, name);
        const found = await existing(link);
        if (found.kind === 'missing') {
            await symlink(target, link);
            report.linked.push(name);
        } else if (found.kind === 'real' || resolve(own, found.target) !== target) {
            report.unshared.push(name);
        }
    }
    return report;
};
