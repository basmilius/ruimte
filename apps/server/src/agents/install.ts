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
const HOOK_MAX_TIME_S = 3;

/*
 * The permission hook is the one the daemon answers late: it holds the request while a person
 * decides in a node header. The three numbers are a ladder around `APPROVAL_HOLD_MS`, so the
 * daemon always lets go first and the CLI never has to cut anything off. The CLI is showing its
 * own prompt the whole time, so a hook that waits costs the agent nothing.
 */
const APPROVAL_EVENT = 'PermissionRequest';
const APPROVAL_TIMEOUT_S = 125;
const APPROVAL_MAX_TIME_S = 120;

/*
 * Outside Ruimte the variables are unset and the hook only drains stdin, so the same settings
 * file serves a plain terminal too. `exit 0` keeps a failed POST from ever blocking the CLI.
 * The response body goes to stdout on purpose: on a prompt hook the daemon answers with the
 * session's context hint and on a permission hook with the decision, which Claude Code reads
 * from there. `-f` keeps an error page from being printed too, since the CLI would take that
 * text as context as well.
 */
export const hookCommand = (kind: AgentKind, event?: string): string => {
    const maxTime = event === APPROVAL_EVENT ? APPROVAL_MAX_TIME_S : HOOK_MAX_TIME_S;
    return `if [ -n "$RUIMTE_HOOK_URL" ]; then curl -sf -m ${maxTime} -X POST "$RUIMTE_HOOK_URL/${kind}" -H "Authorization: Bearer $RUIMTE_HOOK_TOKEN" -H "Content-Type: application/json" --data-binary @-; else cat >/dev/null 2>&1; fi; exit 0`;
};

// A `command` hook with curl, never Claude Code's `http` kind: that one cannot read the port from the
// environment and reports an error whenever Ruimte is not running.
interface HookEntry {
    type: 'command';
    command: string;
    timeout: number;
}

const hookEntry = (kind: AgentKind, event: string): HookEntry => ({
    type: 'command',
    command: hookCommand(kind, event),
    timeout: event === APPROVAL_EVENT ? APPROVAL_TIMEOUT_S : HOOK_TIMEOUT_S
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

    const allEvents = new Set([...wantedEvents, ...Object.keys(hooks)]);
    for (const event of allEvents) {
        const wanted = hookEntry(kind, event);
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
            throw new Error(`Cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    await mkdir(dirname(path), { recursive: true });
    await writeAtomic(path, CODEX_RULES, 0o644);
    return 'written';
};

// Codex loads every `*.rules` file in this folder.
export const defaultCodexRulesPath = (env: Record<string, string | undefined> = process.env): string =>
    join(env.CODEX_HOME ?? join(env.HOME ?? homedir(), '.codex'), 'rules', 'ruimte.rules');
