import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentKind } from '@ruimte/contracts';
import { isNotFound, writeAtomic, KeyedSerializer } from '@adecore/agents';
import {
    codexRulesPathIn as codexRulesPathInFolder,
    codexRulesText,
    defaultCodexHome,
    installCodexRules as installCodexRulesAt,
    type CodexRules
} from '@adecore/agents/providers';
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
export function hookCommand(kind: AgentKind): string {
    return `if [ -n "$RUIMTE_HOOK_URL" ]; then curl -sf -m ${HOOK_MAX_TIME_S} -X POST "$RUIMTE_HOOK_URL/${kind}" -H "Authorization: Bearer $RUIMTE_HOOK_TOKEN" -H "Content-Type: application/json" --data-binary @-; else cat >/dev/null 2>&1; fi; exit 0`;
}

// A `command` hook with curl, never Claude Code's `http` kind: that one cannot read the port from the
// environment and reports an error whenever Ruimte is not running.
type HookEntry = Record<string, string | number>;

/*
 * How a CLI lays out a hooks file. `groups` is Claude Code's (`hooks.<Event>[].hooks[]`), which Codex and Grok read too;
 * `entries` is Copilot's (`hooks.<Event>[]`, under `version: 1`); `named` is Antigravity's, whose top level names each hook.
 */
export type HookShape = 'groups' | 'entries' | 'named';

export function shapeOf(kind: AgentKind): HookShape {
    if (kind === 'copilot') {
        return 'entries';
    }
    return kind === 'antigravity' ? 'named' : 'groups';
}

// The key Ruimte's hook goes under in Antigravity's `hooks.json`, whose top level names each hook.
export const NAMED_HOOK = 'ruimte';

export function hookEntry(kind: AgentKind): HookEntry {
    if (kind === 'copilot') {
        // Copilot names the shell its command runs in, and its timeout in seconds.
        return { type: 'command', bash: hookCommand(kind), timeoutSec: HOOK_TIMEOUT_S };
    }
    return {
        type: 'command',
        command: hookCommand(kind),
        timeout: HOOK_TIMEOUT_S
    };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isOurs(hook: unknown): boolean {
    return isRecord(hook) && [hook.command, hook.bash].some((command) => typeof command === 'string' && command.includes(HOOK_MARKER));
}

export function sameEntry(hook: unknown, wanted: HookEntry): boolean {
    return isRecord(hook) && Object.entries(wanted).every(([key, value]) => hook[key] === value);
}

export interface SettingsMerge {
    config: Record<string, unknown>;
    changed: boolean;
    refused: boolean;
}

/*
 * Puts one Ruimte hook under every event the daemon listens for and leaves everything else in
 * the config alone: other tools' hooks, other keys, unknown fields on our own group. Answers the
 * new config and whether anything changed, so an unchanged file is never rewritten. A config whose
 * top level, `hooks` or an event is not the shape the CLI reads is refused, never rebuilt.
 */
export function mergeHooks(config: unknown, kind: AgentKind): SettingsMerge {
    const shape = shapeOf(kind);
    if (shape === 'named') {
        return mergeNamedHook(config, kind);
    }
    const shapeKept = isRecord(config) && (config.hooks === undefined || (isRecord(config.hooks) && Object.values(config.hooks).every(Array.isArray)));
    if (!shapeKept) {
        return { config: {}, changed: false, refused: true };
    }
    const root: Record<string, unknown> = { ...(config as Record<string, unknown>) };
    const hooks: Record<string, unknown> = isRecord(root.hooks) ? { ...root.hooks } : {};
    const wantedEvents = new Set(HOOK_EVENTS[kind] ?? []);
    let changed = false;
    if (shape === 'entries' && root.version === undefined) {
        root.version = 1;
        changed = true;
    }

    const wanted = hookEntry(kind);
    const allEvents = new Set([...wantedEvents, ...Object.keys(hooks)]);
    for (const event of allEvents) {
        const groups = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
        const merged = shape === 'entries' ? mergeEntries(groups, wanted, wantedEvents.has(event)) : mergeGroups(groups, wanted, wantedEvents.has(event));
        changed ||= merged.changed;
        if (merged.next.length > 0) {
            hooks[event] = merged.next;
        } else {
            delete hooks[event];
        }
    }

    root.hooks = hooks;
    return { config: root, changed, refused: false };
}

/* One event of a `groups` file: our hook in the first group that holds one, or a group of its own. */
function mergeGroups(groups: unknown[], wanted: HookEntry, isWanted: boolean): { next: unknown[]; changed: boolean } {
    let placed = false;
    let changed = false;
    const next: unknown[] = [];
    for (const group of groups) {
        if (!isRecord(group) || !Array.isArray(group.hooks)) {
            next.push(group);
            continue;
        }
        const kept: unknown[] = [];
        let groupChanged = false;
        for (const hook of group.hooks) {
            if (!isOurs(hook)) {
                kept.push(hook);
                continue;
            }
            if (isWanted && !placed) {
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
            next.push(groupChanged ? { ...group, hooks: kept } : group);
        } else if (group.hooks.length === 0) {
            next.push(group);
        }
    }
    if (isWanted && !placed) {
        next.push({ hooks: [wanted] });
        changed = true;
    }
    return { next, changed };
}

/* One event of an `entries` file: the same, one level up. */
function mergeEntries(entries: unknown[], wanted: HookEntry, isWanted: boolean): { next: unknown[]; changed: boolean } {
    let placed = false;
    let changed = false;
    const next: unknown[] = [];
    for (const entry of entries) {
        if (!isOurs(entry)) {
            next.push(entry);
        } else if (isWanted && !placed) {
            placed = true;
            next.push(sameEntry(entry, wanted) ? entry : { ...wanted });
            changed ||= !sameEntry(entry, wanted);
        } else {
            changed = true;
        }
    }
    if (isWanted && !placed) {
        next.push({ ...wanted });
        changed = true;
    }
    return { next, changed };
}

/* Antigravity's hook under a name of its own, one entry per event; a name a person filled differently is refused. */
function namedHook(kind: AgentKind): Record<string, HookEntry[]> {
    return Object.fromEntries((HOOK_EVENTS[kind] ?? []).map((event) => [event, [hookEntry(kind)]]));
}

function mergeNamedHook(config: unknown, kind: AgentKind): SettingsMerge {
    if (!isRecord(config)) {
        return { config: {}, changed: false, refused: true };
    }
    const wanted = namedHook(kind);
    const current = config[NAMED_HOOK];
    if (current !== undefined && !isOursNamed(current)) {
        return { config: {}, changed: false, refused: true };
    }
    if (JSON.stringify(current) === JSON.stringify(wanted)) {
        return { config, changed: false, refused: false };
    }
    return { config: { ...config, [NAMED_HOOK]: wanted }, changed: true, refused: false };
}

/* Whether a named hook holds Ruimte's command under any of its events. */
export function isOursNamed(value: unknown): boolean {
    return isRecord(value) && Object.values(value).some((entries) => Array.isArray(entries) && entries.some(isOurs));
}

/* Whether a hooks file of a CLI holds a hook of Ruimte's anywhere it would run. */
export function holdsOurHook(config: unknown, kind: AgentKind): boolean {
    if (!isRecord(config)) {
        return false;
    }
    if (shapeOf(kind) === 'named') {
        return isOursNamed(config[NAMED_HOOK]);
    }
    if (!isRecord(config.hooks)) {
        return false;
    }
    return Object.values(config.hooks).some(
        (groups) =>
            Array.isArray(groups) && groups.some((group) => isOurs(group) || (isRecord(group) && Array.isArray(group.hooks) && group.hooks.some(isOurs)))
    );
}

type InstallResult = 'unchanged' | 'written';

export interface HooksInstall {
    result: InstallResult;
    // What the file lacked before, so turning the hooks off can leave it as it was found.
    createdFile: boolean;
    createdHooksKey: boolean;
}

/* A settings file that is not an object, or whose `hooks` is not one, is a person's and is never rewritten. */
export class HookFileRefused extends Error {}

// One edit of a file at a time, by real path, so two installs in a row never read the same text.
const hookFiles = new KeyedSerializer();

export const HOOK_FILE_RETRIES = 3;

/* The one place a hook settings file is edited: the install and the revoke queue behind each other here. */
export function editingHookFile<T>(path: string, work: () => Promise<T>): Promise<T> {
    return hookFiles.run(path, work);
}

export async function textOrNull(path: string): Promise<string | null> {
    try {
        return await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return null;
        }
        throw new Error(`Cannot read ${path}: ${errorText(e)}`);
    }
}

/* Idempotent: the second run on the same file is a no-op. A file that is not JSON, or not an object, is left alone (throws). */
export function installHooks(link: string, kind: AgentKind): Promise<HooksInstall> {
    const key = shapeOf(kind) === 'named' ? NAMED_HOOK : 'hooks';
    return mergeIntoSettings(link, key, (config) => mergeHooks(config, kind), 'is not a settings object with hooks in the shape the CLI reads');
}

/* Merges into a JSON settings file of a CLI, written only when the merge changed something; `key` is the one top-level key Ruimte writes under. */
async function mergeIntoSettings(link: string, key: string, merge: (config: unknown) => SettingsMerge, refusal: string): Promise<HooksInstall> {
    // Written where a symlink points, since a rename over the link itself would cut a dotfiles checkout loose.
    const path = await realpath(link).catch(() => link);
    return await editingHookFile(path, async () => {
        for (let attempt = 0; attempt < HOOK_FILE_RETRIES; attempt++) {
            const text = await textOrNull(path);
            let existing: unknown = {};
            if (text !== null) {
                try {
                    existing = JSON.parse(text);
                } catch (e) {
                    throw new Error(`Cannot read ${path}: ${errorText(e)}`);
                }
            }
            const { config, changed, refused } = merge(existing);
            if (refused) {
                throw new HookFileRefused(`${path} ${refusal}, so Ruimte leaves it alone`);
            }
            const created = { createdFile: text === null, createdHooksKey: !isRecord(existing) || existing[key] === undefined };
            if (!changed) {
                return { result: 'unchanged', ...created };
            }
            const mode = await stat(path).then(
                (stats) => stats.mode & 0o777,
                () => 0o644
            );
            await mkdir(dirname(path), { recursive: true });
            // A CLI or an editor that wrote since the read would lose its change to ours.
            if ((await textOrNull(path)) !== text) {
                continue;
            }
            await writeAtomic(path, `${JSON.stringify(config, null, 2)}\n`, mode);
            return { result: 'written', ...created };
        }
        throw new Error(`${path} kept changing; try again`);
    });
}

/* The file a CLI reads user-level hooks from inside one of its config folders; null for a CLI whose hooks the daemon cannot read. */
export function hookPathIn(kind: AgentKind, folder: string): string | null {
    if (kind === 'claude') {
        return join(folder, 'settings.json');
    }
    if (kind === 'codex') {
        return join(folder, 'hooks.json');
    }
    // A file of Ruimte's own among the CLI's hook files, each of which it reads.
    if (kind === 'grok' || kind === 'copilot') {
        return join(folder, 'hooks', 'ruimte.json');
    }
    if (kind === 'antigravity') {
        return join(folder, 'config', 'hooks.json');
    }
    return null;
}

/* The folder a CLI reads its own settings from when nothing points it elsewhere; null for a CLI the daemon cannot wire. */
export function defaultConfigFolder(kind: AgentKind, env: Record<string, string | undefined> = process.env): string | null {
    if (kind === 'claude') {
        return env.CLAUDE_CONFIG_DIR ?? join(env.HOME ?? homedir(), '.claude');
    }
    if (kind === 'codex') {
        return defaultCodexHome(env);
    }
    if (kind === 'antigravity') {
        return env.GEMINI_HOME ?? join(env.HOME ?? homedir(), '.gemini');
    }
    if (kind === 'grok') {
        return env.GROK_HOME ?? join(env.HOME ?? homedir(), '.grok');
    }
    if (kind === 'copilot') {
        return env.COPILOT_HOME ?? join(env.HOME ?? homedir(), '.copilot');
    }
    return null;
}

/* Lets Codex run `ruimte-context` outside its sandbox without asking; the daemon already enforces every verb (mode ceiling, depth, cwd). */
const RUIMTE_CODEX_RULES: CodexRules = { app: 'Ruimte', commands: ['ruimte-context'] };

export const CODEX_RULES = codexRulesText(RUIMTE_CODEX_RULES);

export function installCodexRules(path: string): Promise<InstallResult> {
    return installCodexRulesAt(path, RUIMTE_CODEX_RULES);
}

export function codexRulesPathIn(folder: string): string {
    return codexRulesPathInFolder(folder, RUIMTE_CODEX_RULES);
}

export function defaultCodexRulesPath(env: Record<string, string | undefined> = process.env): string {
    return codexRulesPathIn(defaultCodexHome(env));
}

/*
 * Lets Antigravity's `agy` run `ruimte-context` without asking, and outside its sandbox, which keeps it from the daemon.
 * Rule syntax and file: https://antigravity.google/docs/permissions ("CLI fine-grained permissions").
 */
export const ANTIGRAVITY_RULES: readonly string[] = ['command(ruimte-context)', 'unsandboxed(ruimte-context)'];

export function antigravitySettingsPathIn(folder: string): string {
    return join(folder, 'antigravity-cli', 'settings.json');
}

function antigravityAllow(config: unknown): { permissions: Record<string, unknown>; allow: unknown[] } | null {
    if (!isRecord(config) || (config.permissions !== undefined && !isRecord(config.permissions))) {
        return null;
    }
    const permissions = isRecord(config.permissions) ? config.permissions : {};
    if (permissions.allow !== undefined && !Array.isArray(permissions.allow)) {
        return null;
    }
    return { permissions, allow: Array.isArray(permissions.allow) ? permissions.allow : [] };
}

/* Adds Ruimte's rules to `permissions.allow` and leaves every other entry and key where it was. */
export function mergeAntigravityRules(config: unknown): SettingsMerge {
    const found = antigravityAllow(config);
    if (found === null) {
        return { config: {}, changed: false, refused: true };
    }
    const missing = ANTIGRAVITY_RULES.filter((rule) => !found.allow.includes(rule));
    if (missing.length === 0) {
        return { config: config as Record<string, unknown>, changed: false, refused: false };
    }
    return {
        config: { ...(config as Record<string, unknown>), permissions: { ...found.permissions, allow: [...found.allow, ...missing] } },
        changed: true,
        refused: false
    };
}

/* Takes exactly Ruimte's rules out; a `permissions` key Ruimte created goes with them once nothing else is in it. */
export function removeAntigravityRules(config: unknown, createdKey: boolean): SettingsMerge & { removed: number } {
    const found = antigravityAllow(config);
    if (found === null) {
        return { config: {}, changed: false, refused: true, removed: 0 };
    }
    const allow = found.allow.filter((rule) => typeof rule !== 'string' || !ANTIGRAVITY_RULES.includes(rule));
    const removed = found.allow.length - allow.length;
    if (removed === 0) {
        return { config: config as Record<string, unknown>, changed: false, refused: false, removed };
    }
    const root: Record<string, unknown> = { ...(config as Record<string, unknown>) };
    const permissions: Record<string, unknown> = { ...found.permissions, allow };
    if (createdKey && allow.length === 0 && Object.keys(permissions).length === 1) {
        delete root.permissions;
    } else {
        root.permissions = permissions;
    }
    return { config: root, changed: true, refused: false, removed };
}

export function hasAntigravityRules(config: unknown): boolean {
    const found = antigravityAllow(config);
    return found !== null && found.allow.some((rule) => typeof rule === 'string' && ANTIGRAVITY_RULES.includes(rule));
}

export function installAntigravityRules(link: string): Promise<HooksInstall> {
    return mergeIntoSettings(link, 'permissions', mergeAntigravityRules, 'is not a settings object with permissions in the shape agy reads');
}

export interface FolderInstall extends HooksInstall {
    path: string;
    kind: 'hooks' | 'rules';
}

/*
 * Everything the daemon puts in one config folder of a CLI: its hooks, for Codex the rule that lets
 * `ruimte-context` out of the sandbox, and for Antigravity the rule that lets `agy` run it without asking.
 * Answers what was written where, so the caller can say so.
 */
export async function installInFolder(kind: AgentKind, folder: string): Promise<FolderInstall[]> {
    const installs: FolderInstall[] = [];
    if (kind === 'antigravity') {
        const path = antigravitySettingsPathIn(folder);
        installs.push({ path, kind: 'rules', ...(await installAntigravityRules(path)) });
    }
    const hookPath = hookPathIn(kind, folder);
    if (hookPath === null) {
        return installs;
    }
    installs.push({ path: hookPath, kind: 'hooks', ...(await installHooks(hookPath, kind)) });
    if (kind === 'codex') {
        const rulesPath = codexRulesPathIn(folder);
        const existed = await stat(rulesPath).then(
            () => true,
            () => false
        );
        installs.push({ path: rulesPath, kind: 'rules', result: await installCodexRules(rulesPath), createdFile: !existed, createdHooksKey: false });
    }
    return installs;
}
