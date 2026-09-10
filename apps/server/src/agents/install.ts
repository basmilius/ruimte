import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { AgentKind } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '../fs.ts';
import { HOOK_EVENTS } from './hooks.ts';

// The one string the installer recognizes its own hook by, across versions of the command.
export const HOOK_MARKER = 'RUIMTE_HOOK_URL';

// Seconds the CLI waits for the hook; the POST is loopback, so anything longer means the daemon is gone.
const HOOK_TIMEOUT_S = 5;

/*
 * Outside Ruimte the variables are unset and the hook only drains stdin, so the same settings
 * file serves a plain terminal too. `exit 0` keeps a failed POST from ever blocking the CLI.
 * The response body goes to stdout on purpose: on a prompt hook the daemon answers with the
 * session's context hint, which Claude Code reads from there. `-f` keeps an error page from
 * being printed too, since the CLI would take that text as context as well.
 */
export const hookCommand = (kind: AgentKind): string =>
    `if [ -n "$RUIMTE_HOOK_URL" ]; then curl -sf -m 3 -X POST "$RUIMTE_HOOK_URL/${kind}" -H "Authorization: Bearer $RUIMTE_HOOK_TOKEN" -H "Content-Type: application/json" --data-binary @-; else cat >/dev/null 2>&1; fi; exit 0`;

interface HookEntry {
    type: 'command';
    command: string;
    timeout: number;
}

const hookEntry = (kind: AgentKind): HookEntry => ({ type: 'command', command: hookCommand(kind), timeout: HOOK_TIMEOUT_S });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isOurs = (hook: unknown): boolean => isRecord(hook) && typeof hook.command === 'string' && hook.command.includes(HOOK_MARKER);

const sameEntry = (hook: unknown, wanted: HookEntry): boolean =>
    isRecord(hook) && hook.type === wanted.type && hook.command === wanted.command && hook.timeout === wanted.timeout;

/*
 * Puts one Ruimte hook under every event the daemon listens for and leaves everything else in
 * the config alone: other tools' hooks, other keys, unknown fields on our own group. Answers the
 * new config and whether anything changed, so an unchanged file is never rewritten.
 */
export const mergeHooks = (config: unknown, kind: AgentKind): { config: Record<string, unknown>; changed: boolean } => {
    const root: Record<string, unknown> = isRecord(config) ? { ...config } : {};
    const hooks: Record<string, unknown> = isRecord(root.hooks) ? { ...root.hooks } : {};
    const wanted = hookEntry(kind);
    const wantedEvents = new Set(HOOK_EVENTS[kind] ?? []);
    let changed = false;

    const allEvents = new Set([...wantedEvents, ...Object.keys(hooks)]);
    for (const event of allEvents) {
        const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
        let placed = false;
        const nextGroups: unknown[] = [];
        for (const group of groups) {
            if (!isRecord(group) || !Array.isArray(group.hooks)) {
                nextGroups.push(group);
                continue;
            }
            const kept: unknown[] = [];
            let groupChanged = false;
            for (const hook of group.hooks) {
                if (!isOurs(hook)) {
                    kept.push(hook);
                    continue;
                }
                if (wantedEvents.has(event) && !placed) {
                    placed = true;
                    if (sameEntry(hook, wanted)) {
                        kept.push(hook);
                    } else {
                        kept.push(wanted);
                        groupChanged = true;
                    }
                } else {
                    // A second copy, or an event the daemon stopped listening for.
                    groupChanged = true;
                }
            }
            changed ||= groupChanged;
            if (kept.length > 0) {
                nextGroups.push(groupChanged ? { ...group, hooks: kept } : group);
            } else if (group.hooks.length === 0) {
                nextGroups.push(group);
            }
        }
        if (wantedEvents.has(event) && !placed) {
            nextGroups.push({ hooks: [wanted] });
            changed = true;
        }
        if (nextGroups.length > 0) {
            hooks[event] = nextGroups;
        } else {
            delete hooks[event];
        }
    }

    root.hooks = hooks;
    return { config: root, changed };
};

type InstallResult = 'unchanged' | 'written';

/* Idempotent: the second run on the same file is a no-op. A file that is not JSON is left alone (throws). */
export const installHooks = async (path: string, kind: AgentKind): Promise<InstallResult> => {
    let existing: unknown = {};
    try {
        existing = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
        if (!isNotFound(e)) {
            throw new Error(`Cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    const { config, changed } = mergeHooks(existing, kind);
    if (!changed) {
        return 'unchanged';
    }
    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, `${JSON.stringify(config, null, 2)}\n`, 0o644);
    return 'written';
};

// Where each CLI reads user-level hooks from; a CLI whose hooks the daemon cannot read is not listed.
export const defaultHookPaths = (env: Record<string, string | undefined> = process.env): Partial<Record<AgentKind, string>> => {
    const home = env.HOME ?? homedir();
    return {
        claude: join(env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), 'settings.json'),
        codex: join(env.CODEX_HOME ?? join(home, '.codex'), 'hooks.json')
    };
};
