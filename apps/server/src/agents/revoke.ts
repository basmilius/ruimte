import { mkdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AgentIntegrationReport, AgentKind } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '@adecore/agents';
import { errorText } from '../error-text.ts';
import {
    CODEX_RULES,
    HOOK_FILE_RETRIES,
    editingHookFile,
    hookEntry,
    isOurs,
    isRecord,
    removeAntigravityRules,
    sameEntry,
    textOrNull,
    type SettingsMerge
} from './install.ts';

/* What the ledger remembers of a file Ruimte wrote into. */
export interface LedgerEntry {
    createdFile: boolean;
    createdHooksKey: boolean;
}

export interface HooksRemoval {
    config: Record<string, unknown>;
    // Ruimte hooks taken out.
    removed: number;
    // Hooks that carry Ruimte's marker but are not what Ruimte writes: a person changed them, so they stay.
    keptEdited: number;
    refused: boolean;
}

/*
 * Takes out exactly the hooks Ruimte writes and nothing around them. Containers Ruimte made go with
 * the last hook in them; a key or group that was there before, or holds anything else, stays.
 */
export function removeHooks(config: unknown, kind: AgentKind, ledger: Pick<LedgerEntry, 'createdHooksKey'>): HooksRemoval {
    if (!isRecord(config) || (config.hooks !== undefined && !isRecord(config.hooks))) {
        return { config: {}, removed: 0, keptEdited: 0, refused: true };
    }
    const wanted = hookEntry(kind);
    const root: Record<string, unknown> = { ...config };
    let removed = 0;
    let keptEdited = 0;
    if (isRecord(root.hooks)) {
        const hooks: Record<string, unknown> = { ...root.hooks };
        for (const [event, groups] of Object.entries(hooks)) {
            if (!Array.isArray(groups)) {
                continue;
            }
            const before = removed;
            const nextGroups: unknown[] = [];
            for (const group of groups) {
                if (!isRecord(group) || !Array.isArray(group.hooks)) {
                    nextGroups.push(group);
                    continue;
                }
                const kept = group.hooks.filter((hook: unknown) => {
                    if (sameEntry(hook, wanted)) {
                        removed++;
                        return false;
                    }
                    if (isOurs(hook)) {
                        keptEdited++;
                    }
                    return true;
                });
                if (kept.length === group.hooks.length) {
                    nextGroups.push(group);
                } else if (kept.length > 0 || Object.keys(group).some((key) => key !== 'hooks')) {
                    nextGroups.push({ ...group, hooks: kept });
                }
            }
            if (removed === before) {
                continue;
            }
            if (nextGroups.length > 0) {
                hooks[event] = nextGroups;
            } else {
                delete hooks[event];
            }
        }
        if (Object.keys(hooks).length === 0 && ledger.createdHooksKey) {
            delete root.hooks;
        } else {
            root.hooks = hooks;
        }
    }
    return { config: root, removed, keptEdited, refused: false };
}

/* Takes Ruimte's hooks out of one settings file, with the same queue and re-read check as the install. */
export function revokeHooks(link: string, kind: AgentKind, entry: LedgerEntry): Promise<AgentIntegrationReport> {
    return removeFromSettings(link, 'hooks', entry, (config) => {
        const removal = removeHooks(config, kind, entry);
        return { ...removal, changed: removal.removed > 0 };
    });
}

/* Takes Ruimte's rules out of `agy`'s settings; a rule a person added themselves reads the same and goes too. */
export function revokeAntigravityRules(link: string, entry: LedgerEntry): Promise<AgentIntegrationReport> {
    return removeFromSettings(link, 'rules', entry, (config) => ({ ...removeAntigravityRules(config, entry.createdHooksKey), keptEdited: 0 }));
}

async function removeFromSettings(
    link: string,
    kind: AgentIntegrationReport['kind'],
    entry: LedgerEntry,
    remove: (config: unknown) => SettingsMerge & { keptEdited: number }
): Promise<AgentIntegrationReport> {
    const path = await realpath(link).catch(() => link);
    const report = (outcome: AgentIntegrationReport['outcome'], message?: string): AgentIntegrationReport => ({
        path: link,
        kind,
        outcome,
        ...(message === undefined ? {} : { message })
    });
    try {
        return await editingHookFile(path, async () => {
            for (let attempt = 0; attempt < HOOK_FILE_RETRIES; attempt++) {
                const text = await textOrNull(path);
                if (text === null) {
                    return report('missing');
                }
                let parsed: unknown;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    return report('refused');
                }
                const removal = remove(parsed);
                if (removal.refused) {
                    return report('refused');
                }
                if (!removal.changed) {
                    return removal.keptEdited > 0 ? report('kept-edited') : report('none');
                }
                if ((await textOrNull(path)) !== text) {
                    continue;
                }
                if (entry.createdFile && Object.keys(removal.config).length === 0) {
                    await rm(path, { force: true });
                    return report('deleted');
                }
                const mode = await stat(path).then(
                    (stats) => stats.mode & 0o777,
                    () => 0o644
                );
                await mkdir(dirname(path), { recursive: true });
                await writeAtomic(path, `${JSON.stringify(removal.config, null, 2)}\n`, mode);
                return report('removed', removal.keptEdited > 0 ? 'An entry you edited was left in place' : undefined);
            }
            throw new Error(`${path} kept changing; try again`);
        });
    } catch (e) {
        return report('failed', errorText(e));
    }
}

/* The rules file is Ruimte's whole: it goes only while it still says what Ruimte wrote. */
export async function revokeCodexRules(path: string): Promise<AgentIntegrationReport> {
    try {
        const text = await readFile(path, 'utf8');
        if (text !== CODEX_RULES) {
            return { path, kind: 'rules', outcome: 'kept-edited' };
        }
        await rm(path, { force: true });
        return { path, kind: 'rules', outcome: 'deleted' };
    } catch (e) {
        if (isNotFound(e)) {
            return { path, kind: 'rules', outcome: 'missing' };
        }
        return { path, kind: 'rules', outcome: 'failed', message: errorText(e) };
    }
}
