import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentKind } from '@ruimte/contracts';
import { isNotFound, writeAtomic } from '../fs.ts';
import { HOOK_EVENTS } from './hooks.ts';
import { errorText } from '../error-text.ts';

// The one string the installer recognizes its own hook by, across versions of the command.
export const HOOK_MARKER = 'RUIMTE_HOOK_URL';

// Seconds the CLI waits for the hook; the POST is loopback, so anything longer means the daemon is gone.
// Codex clamps a SessionEnd or Interrupt hook to 3 s and warns on screen about anything longer.
const HOOK_TIMEOUT_S = 3;
const HOOK_MAX_TIME_S = 2;

/*
 * Outside Ruimte the hook only drains stdin. Inside it, stdout carries daemon context;
 * failed HTTP responses stay silent and never block the CLI.
 */
export const hookCommand = (kind: AgentKind): string =>
    `if [ -n "$RUIMTE_HOOK_URL" ]; then curl -sf -m ${HOOK_MAX_TIME_S} -X POST "$RUIMTE_HOOK_URL/${kind}" -H "Authorization: Bearer $RUIMTE_HOOK_TOKEN" -H "Content-Type: application/json" --data-binary @-; else cat >/dev/null 2>&1; fi; exit 0`;

// A `command` hook with curl, never Claude Code's `http` kind: that one cannot read the port from the
// environment and reports an error whenever Ruimte is not running.
interface HookEntry {
    type: 'command';
    command: string;
    timeout: number;
}

const hookEntry = (kind: AgentKind): HookEntry => ({
    type: 'command',
    command: hookCommand(kind),
    timeout: HOOK_TIMEOUT_S
});

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
    const wantedEvents = new Set(HOOK_EVENTS[kind] ?? []);
    let changed = false;

    const wanted = hookEntry(kind);
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
export const installHooks = async (link: string, kind: AgentKind): Promise<InstallResult> => {
    // Written where a symlink points, since a rename over the link itself would cut a dotfiles checkout loose.
    const path = await realpath(link).catch(() => link);
    let existing: unknown = {};
    try {
        existing = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
        if (!isNotFound(e)) {
            throw new Error(`Cannot read ${path}: ${errorText(e)}`);
        }
    }
    const { config, changed } = mergeHooks(existing, kind);
    if (!changed) {
        return 'unchanged';
    }
    const mode = await stat(path).then(
        (stats) => stats.mode & 0o777,
        () => 0o644
    );
    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, `${JSON.stringify(config, null, 2)}\n`, mode);
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

/*
 * Lets Codex run `ruimte-context` outside its sandbox without asking: the seatbelt of workspace-write
 * blocks every socket, loopback included, and Codex 0.154 has no setting that opens only the daemon's.
 * The daemon already enforces every verb (mode ceiling, depth, cwd). A file of its own, so a person's
 * `default.rules` is never touched, and rules only load from this folder, never from a flag.
 */
export const CODEX_RULES = '# Written by Ruimte; it is rewritten when it changes.\nprefix_rule(pattern=["ruimte-context"], decision="allow")\n';

/* Idempotent like the hooks: a file that already says the same is left alone. */
export const installCodexRules = async (path: string): Promise<InstallResult> => {
    try {
        if ((await readFile(path, 'utf8')) === CODEX_RULES) {
            return 'unchanged';
        }
    } catch (e) {
        if (!isNotFound(e)) {
            throw new Error(`Cannot read ${path}: ${errorText(e)}`);
        }
    }
    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, CODEX_RULES, 0o644);
    return 'written';
};

// Codex loads every `*.rules` file in this folder.
export const defaultCodexRulesPath = (env: Record<string, string | undefined> = process.env): string =>
    join(env.CODEX_HOME ?? join(env.HOME ?? homedir(), '.codex'), 'rules', 'ruimte.rules');
