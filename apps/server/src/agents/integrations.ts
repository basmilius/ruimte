import { mkdir, readFile, realpath, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AgentIntegrationFile, AgentIntegrationReport, AgentIntegrationsSummary, AgentKind } from '@ruimte/contracts';
import { isNotFound, writeAtomic, Serializer } from '@adecore/agents';
import { errorText } from '../error-text.ts';
import {
    CODEX_RULES,
    HookFileRefused,
    antigravitySettingsPathIn,
    codexRulesPathIn,
    hasAntigravityRules,
    defaultConfigFolder,
    hookPathIn,
    installInFolder,
    isOurs,
    isRecord,
    type FolderInstall
} from './install.ts';
import { revokeAntigravityRules, revokeCodexRules, revokeHooks, type LedgerEntry } from './revoke.ts';

export const AGENT_INTEGRATIONS_FILE = 'agent-integrations.json';

/* The CLIs whose global settings the daemon can wire. */
export const INTEGRATION_KINDS = ['claude', 'codex', 'antigravity'] as const satisfies readonly AgentKind[];

export function isIntegrationKind(kind: string): kind is (typeof INTEGRATION_KINDS)[number] {
    return (INTEGRATION_KINDS as readonly string[]).includes(kind);
}

const WrittenSchema = z.object({
    path: z.string(),
    kind: z.enum(['hooks', 'rules']),
    createdFile: z.boolean(),
    createdHooksKey: z.boolean()
});
type Written = z.infer<typeof WrittenSchema>;

const ProviderStateSchema = z.object({
    state: z.enum(['unset', 'on', 'off']),
    reviewed: z.boolean(),
    written: z.array(WrittenSchema).default([])
});
type ProviderState = z.infer<typeof ProviderStateSchema>;

/* Asked to change what `--no-hooks` decides. */
export class IntegrationsFixed extends Error {}

export interface AgentIntegrationsOptions {
    home: string;
    // `--no-hooks`: nothing is written or removed, whatever the choice says.
    fixed: boolean;
    env?: Record<string, string | undefined>;
    // The config folders of the accounts of a kind besides the default one; asked lazily, since accounts load after this.
    accountHomes: (kind: AgentKind) => string[];
    // Whether a CLI is on the machine; one that is not is left out of the summary, so nobody is asked about it. Absent counts all.
    installed?: (kind: AgentKind) => Promise<boolean>;
}

function unset(): ProviderState {
    return { state: 'unset', reviewed: false, written: [] };
}

function expandHome(path: string, env: Record<string, string | undefined>): string {
    const home = env.HOME ?? env.USERPROFILE ?? '';
    if (path === '~') {
        return home;
    }
    return path.startsWith('~/') ? join(home, path.slice(2)) : path;
}

async function realOrSelf(path: string): Promise<string> {
    return await realpath(path).catch(() => path);
}

async function jsonOrNull(path: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    } catch {
        return null;
    }
}

function hasOurHook(config: unknown): boolean {
    if (!isRecord(config) || !isRecord(config.hooks)) {
        return false;
    }
    return Object.values(config.hooks).some(
        (groups) => Array.isArray(groups) && groups.some((group) => isRecord(group) && Array.isArray(group.hooks) && group.hooks.some(isOurs))
    );
}

async function hasOurRules(kind: AgentKind, path: string): Promise<boolean> {
    if (kind === 'antigravity') {
        return hasAntigravityRules(await jsonOrNull(path));
    }
    return (await readFile(path, 'utf8').catch(() => null)) === CODEX_RULES;
}

/*
 * What a person allowed the daemon to write into the CLIs' global settings, kept under the home and
 * changed only through the local secret. A fresh home writes nothing; a home whose CLI already had
 * Ruimte's hooks counts as allowed and asks once more.
 */
export class AgentIntegrations {
    private readonly path: string;
    private readonly fixed: boolean;
    private readonly env: Record<string, string | undefined>;
    private readonly accountHomes: (kind: AgentKind) => string[];
    private readonly installed: ((kind: AgentKind) => Promise<boolean>) | null;
    // The kinds found on the machine at the last look; none until the first one.
    private present: ReadonlySet<string> = new Set();
    private looking: Promise<void> | null = null;
    private readonly queue = new Serializer();
    private readonly listeners = new Set<() => void>();
    private providers: Record<string, ProviderState> = {};
    // The top level of the file past what this release reads, written back as it was.
    private rest: Record<string, unknown> = {};

    constructor(options: AgentIntegrationsOptions) {
        this.path = join(options.home, AGENT_INTEGRATIONS_FILE);
        this.fixed = options.fixed;
        this.env = options.env ?? process.env;
        this.accountHomes = options.accountHomes;
        this.installed = options.installed ?? null;
    }

    /* Reads the choice, or on a home without one works it out from what the CLIs' folders hold and writes it. */
    async load(): Promise<void> {
        const text = await readFile(this.path, 'utf8').catch((e: unknown) => {
            if (isNotFound(e)) {
                return null;
            }
            throw e;
        });
        let parsed: unknown = null;
        try {
            parsed = text === null ? null : JSON.parse(text);
        } catch {
            // Handled below with every other file that holds no choice.
        }
        if (isRecord(parsed) && isRecord(parsed.providers)) {
            const { providers: stored, version: _version, ...rest } = parsed;
            this.rest = rest;
            for (const kind of INTEGRATION_KINDS) {
                const read = ProviderStateSchema.safeParse((stored as Record<string, unknown>)[kind]);
                this.providers[kind] = read.success ? read.data : unset();
            }
            // Providers this release does not know stay as they are.
            for (const [kind, value] of Object.entries(stored)) {
                if (!isIntegrationKind(kind)) {
                    this.providers[kind] = value as ProviderState;
                }
            }
            return;
        }
        if (text !== null) {
            // The markers cannot tell a choice of off from a first run, so a person is asked again rather than turned back on.
            const setAside = `${this.path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
            await rename(this.path, setAside);
            console.warn(`${this.path} would not read; it is kept as ${setAside} and every integration is asked again`);
            for (const kind of INTEGRATION_KINDS) {
                this.providers[kind] = unset();
            }
        } else {
            for (const kind of INTEGRATION_KINDS) {
                this.providers[kind] = (await this.foundIn(kind)) ? { state: 'on', reviewed: false, written: [] } : unset();
            }
        }
        await this.persist();
    }

    summary(): AgentIntegrationsSummary {
        return {
            providers: INTEGRATION_KINDS.filter((kind) => this.installed === null || this.present.has(kind)).map((kind) => ({
                provider: kind,
                state: this.stateOf(kind).state,
                reviewed: this.stateOf(kind).reviewed
            })),
            fixed: this.fixed
        };
    }

    /* Looks again which CLIs are on the machine, and tells the listeners when that changed what a person is asked. */
    refreshInstalled(): Promise<void> {
        const installed = this.installed;
        if (installed === null) {
            return Promise.resolve();
        }
        this.looking ??= (async () => {
            const found = await Promise.all(INTEGRATION_KINDS.map(async (kind) => ((await installed(kind).catch(() => false)) ? [kind] : [])));
            const next = new Set<string>(found.flat());
            const same = next.size === this.present.size && [...next].every((kind) => this.present.has(kind));
            this.present = next;
            if (!same) {
                this.changed();
            }
        })().finally(() => {
            this.looking = null;
        });
        return this.looking;
    }

    allows(kind: AgentKind): boolean {
        return !this.fixed && this.stateOf(kind).state === 'on';
    }

    onChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /* At startup, for each allowed CLI: its default folder. Accounts follow when one launches. */
    installDefaults(): Promise<void> {
        return this.queue.run(async () => {
            for (const kind of INTEGRATION_KINDS) {
                const folder = defaultConfigFolder(kind, this.env);
                if (!this.allows(kind) || folder === null) {
                    continue;
                }
                for (const report of await this.installInto(kind, folder)) {
                    if (report.outcome === 'written') {
                        console.log(`Installed the ${kind} ${report.kind === 'hooks' ? 'status hooks' : 'rule for ruimte-context'} in ${report.path}`);
                    } else if (report.outcome === 'failed' || report.outcome === 'refused') {
                        console.error(`Could not install the ${kind} ${report.kind}: ${report.message ?? 'the file is not a settings object'}`);
                    }
                }
            }
        });
    }

    /* The hook for a folder of an account, which the accounts service calls before it launches a CLI there. */
    installFolder(kind: AgentKind, folder: string): Promise<void> {
        return this.queue.run(async () => {
            if (!this.allows(kind)) {
                return;
            }
            for (const report of await this.installInto(kind, folder)) {
                if (report.outcome === 'written') {
                    console.log(`Installed ${kind} status hooks in ${report.path}`);
                }
            }
        });
    }

    /* A person's choice. Allowing writes now; refusing takes Ruimte's own unchanged entries out and says per file what happened. */
    set(kind: AgentKind, on: boolean): Promise<AgentIntegrationReport[]> {
        return this.queue.run(async () => {
            if (this.fixed) {
                throw new IntegrationsFixed('This machine was started with --no-hooks');
            }
            const current = this.stateOf(kind);
            this.providers[kind] = { ...current, state: on ? 'on' : 'off', reviewed: true };
            await this.persist();
            const reports = on ? await this.installEverywhere(kind) : await this.revokeEverywhere(kind);
            await this.persist();
            this.changed();
            return reports;
        });
    }

    /* Every file the integration writes or would write, for the dialog and the settings to list. Local secret only. */
    async files(): Promise<AgentIntegrationFile[]> {
        const files: AgentIntegrationFile[] = [];
        for (const kind of INTEGRATION_KINDS) {
            const seen = new Set<string>();
            for (const folder of this.foldersOf(kind)) {
                for (const target of this.targetsIn(kind, folder)) {
                    const key = await realOrSelf(target.path);
                    if (seen.has(key)) {
                        continue;
                    }
                    seen.add(key);
                    const present = await stat(target.path).then(
                        () => true,
                        () => false
                    );
                    const ours = present && (target.kind === 'rules' ? await hasOurRules(kind, target.path) : hasOurHook(await jsonOrNull(target.path)));
                    files.push({ provider: kind, path: target.path, kind: target.kind, present, ours });
                }
            }
        }
        return files;
    }

    private stateOf(kind: string): ProviderState {
        return this.providers[kind] ?? unset();
    }

    private changed(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    private foldersOf(kind: AgentKind): string[] {
        const folder = defaultConfigFolder(kind, this.env);
        const accounts = this.accountHomes(kind).map((home) => expandHome(home, this.env));
        return [...(folder === null ? [] : [folder]), ...accounts];
    }

    private targetsIn(kind: AgentKind, folder: string): { path: string; kind: 'hooks' | 'rules' }[] {
        if (kind === 'antigravity') {
            return [{ path: antigravitySettingsPathIn(folder), kind: 'rules' }];
        }
        const hooks = hookPathIn(kind, folder);
        if (hooks === null) {
            return [];
        }
        return [{ path: hooks, kind: 'hooks' }, ...(kind === 'codex' ? [{ path: codexRulesPathIn(folder), kind: 'rules' as const }] : [])];
    }

    /* Whether the CLI's default folder already holds something of Ruimte's, which is how an earlier release left it. */
    private async foundIn(kind: AgentKind): Promise<boolean> {
        const folder = defaultConfigFolder(kind, this.env);
        if (folder === null) {
            return false;
        }
        const hooks = hookPathIn(kind, folder);
        if (hooks !== null && hasOurHook(await jsonOrNull(hooks))) {
            return true;
        }
        if (kind === 'antigravity') {
            return await hasOurRules(kind, antigravitySettingsPathIn(folder));
        }
        return kind === 'codex' && (await hasOurRules(kind, codexRulesPathIn(folder)));
    }

    private async installEverywhere(kind: AgentKind): Promise<AgentIntegrationReport[]> {
        const reports: AgentIntegrationReport[] = [];
        for (const folder of this.foldersOf(kind)) {
            reports.push(...(await this.installInto(kind, folder)));
        }
        return reports;
    }

    private async installInto(kind: AgentKind, folder: string): Promise<AgentIntegrationReport[]> {
        let installs: FolderInstall[];
        try {
            installs = await installInFolder(kind, folder);
        } catch (e) {
            const target = this.targetsIn(kind, folder)[0] ?? { path: folder, kind: 'hooks' };
            return [{ path: target.path, kind: target.kind, outcome: e instanceof HookFileRefused ? 'refused' : 'failed', message: errorText(e) }];
        }
        for (const install of installs) {
            this.remember(kind, install);
        }
        return installs.map((install) => ({ path: install.path, kind: install.kind, outcome: install.result }));
    }

    /* The first time a file is written decides whether it was ours to begin with; later runs only confirm. */
    private remember(kind: AgentKind, install: Written): void {
        const state = this.stateOf(kind);
        if (state.written.some((entry) => entry.path === install.path)) {
            return;
        }
        const { path, kind: fileKind, createdFile, createdHooksKey } = install;
        this.providers[kind] = { ...state, written: [...state.written, { path, kind: fileKind, createdFile, createdHooksKey }] };
    }

    private async revokeEverywhere(kind: AgentKind): Promise<AgentIntegrationReport[]> {
        const state = this.stateOf(kind);
        const ledger = new Map<string, Written>();
        for (const entry of state.written) {
            ledger.set(await realOrSelf(entry.path), entry);
        }
        const targets = new Map<string, { path: string; kind: 'hooks' | 'rules' }>();
        for (const entry of state.written) {
            targets.set(await realOrSelf(entry.path), { path: entry.path, kind: entry.kind });
        }
        for (const folder of this.foldersOf(kind)) {
            for (const target of this.targetsIn(kind, folder)) {
                const key = await realOrSelf(target.path);
                if (!targets.has(key)) {
                    targets.set(key, target);
                }
            }
        }
        const reports: AgentIntegrationReport[] = [];
        for (const [key, target] of targets) {
            const entry: LedgerEntry = ledger.get(key) ?? { createdFile: false, createdHooksKey: false };
            reports.push(await this.revokeTarget(kind, target, entry));
        }
        this.providers[kind] = { ...this.stateOf(kind), written: [] };
        return reports;
    }

    private revokeTarget(kind: AgentKind, target: { path: string; kind: 'hooks' | 'rules' }, entry: LedgerEntry): Promise<AgentIntegrationReport> {
        if (kind === 'antigravity') {
            return revokeAntigravityRules(target.path, entry);
        }
        return target.kind === 'rules' ? revokeCodexRules(target.path) : revokeHooks(target.path, kind, entry);
    }

    private async persist(): Promise<void> {
        const file = { version: 1, providers: this.providers, ...this.rest };
        await mkdir(dirname(this.path), { recursive: true });
        await writeAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`, 0o600, { durable: true });
    }
}
