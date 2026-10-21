import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { AgentIntegrations, IntegrationsFixed } from './integrations.ts';
import { ANTIGRAVITY_RULES, CODEX_RULES, hookEntry, installHooks } from './install.ts';

let root: string;
let home: string;
let env: Record<string, string>;
let accountHomes: string[];

function integrations(fixed = false): AgentIntegrations {
    return new AgentIntegrations({ home, fixed, env, accountHomes: (kind) => (kind === 'claude' ? accountHomes : []) });
}

/* Every file below a folder, relative, so a test can say nothing was written outside the home. */
async function tree(folder: string): Promise<string[]> {
    const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
    return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(folder.length).split(sep).join('/'));
}

function settingsPath(): string {
    return join(env.CLAUDE_CONFIG_DIR!, 'settings.json');
}

async function exists(path: string): Promise<boolean> {
    return await stat(path).then(
        () => true,
        () => false
    );
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-integrations-'));
    home = join(root, 'ruimte-home');
    await mkdir(home);
    env = { HOME: join(root, 'user'), CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex'), GEMINI_HOME: join(root, 'gemini') };
    accountHomes = [];
    await mkdir(env.CLAUDE_CONFIG_DIR!);
    await mkdir(env.CODEX_HOME!);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('AgentIntegrations', () => {
    test('a fresh home writes nothing outside the home, however often it starts', async () => {
        const fresh = integrations();
        await fresh.load();
        await fresh.installDefaults();
        await fresh.installFolder('claude', join(root, 'account'));

        expect(fresh.summary()).toEqual({
            providers: [
                { provider: 'claude', state: 'unset', reviewed: false },
                { provider: 'codex', state: 'unset', reviewed: false },
                { provider: 'antigravity', state: 'unset', reviewed: false }
            ],
            fixed: false
        });
        expect(await tree(root)).toEqual(['/ruimte-home/agent-integrations.json']);
    });

    test('a home that already has the hooks counts as on and has yet to be reviewed', async () => {
        await installHooks(settingsPath(), 'claude');

        const migrated = integrations();
        await migrated.load();

        expect(migrated.summary().providers).toEqual([
            { provider: 'claude', state: 'on', reviewed: false },
            { provider: 'codex', state: 'unset', reviewed: false },
            { provider: 'antigravity', state: 'unset', reviewed: false }
        ]);
        expect(migrated.allows('claude')).toBe(true);
        expect(migrated.allows('codex')).toBe(false);
    });

    test('a file that does not parse is set aside and never turns a provider back on from the markers', async () => {
        await installHooks(settingsPath(), 'claude');
        await writeFile(join(home, 'agent-integrations.json'), '{ not json');

        const subject = integrations();
        await subject.load();

        expect(subject.summary().providers).toEqual([
            { provider: 'claude', state: 'unset', reviewed: false },
            { provider: 'codex', state: 'unset', reviewed: false },
            { provider: 'antigravity', state: 'unset', reviewed: false }
        ]);
        const files = await readdir(home);
        const aside = files.find((name) => name.startsWith('agent-integrations.json.corrupt-'));
        expect(aside).toBeDefined();
        expect(await readFile(join(home, aside!), 'utf8')).toBe('{ not json');
    });

    test('a Codex rules file of Ruimte counts as the migration too', async () => {
        await mkdir(join(env.CODEX_HOME!, 'rules'));
        await writeFile(join(env.CODEX_HOME!, 'rules', 'ruimte.rules'), CODEX_RULES);

        const migrated = integrations();
        await migrated.load();

        expect(migrated.allows('codex')).toBe(true);
    });

    test('the choice survives a restart, and unknown keys are written back', async () => {
        const first = integrations();
        await first.load();
        await first.set('claude', true);
        const file = JSON.parse(await readFile(join(home, 'agent-integrations.json'), 'utf8'));
        await writeFile(join(home, 'agent-integrations.json'), JSON.stringify({ ...file, future: { a: 1 } }));

        const second = integrations();
        await second.load();
        await second.set('codex', false);

        expect(second.allows('claude')).toBe(true);
        expect(JSON.parse(await readFile(join(home, 'agent-integrations.json'), 'utf8')).future).toEqual({ a: 1 });
    });

    test('allowing writes the hooks and says so, and the startup install honors the choice', async () => {
        const allowed = integrations();
        await allowed.load();

        const reports = await allowed.set('claude', true);

        expect(reports).toEqual([{ path: settingsPath(), kind: 'hooks', outcome: 'written' }]);
        expect(await readFile(settingsPath(), 'utf8')).toContain('RUIMTE_HOOK_URL');
        expect(await exists(join(env.CODEX_HOME!, 'hooks.json'))).toBe(false);
    });

    test("turning off after an install into a file with a person's hook keeps theirs and removes Ruimte's", async () => {
        const theirs = { type: 'command', command: 'echo theirs' };
        await writeFile(settingsPath(), JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [theirs] }] } }));
        const subject = integrations();
        await subject.load();
        await subject.set('claude', true);

        const reports = await subject.set('claude', false);

        expect(reports).toEqual([{ path: settingsPath(), kind: 'hooks', outcome: 'removed' }]);
        expect(JSON.parse(await readFile(settingsPath(), 'utf8'))).toEqual({ model: 'opus', hooks: { Stop: [{ hooks: [theirs] }] } });
        expect(subject.summary().providers[0]).toEqual({ provider: 'claude', state: 'off', reviewed: true });
        await subject.installDefaults();
        expect(await readFile(settingsPath(), 'utf8')).not.toContain('RUIMTE_HOOK_URL');
    });

    test('an entry a person edited stays and is reported', async () => {
        const subject = integrations();
        await subject.load();
        await subject.set('claude', true);
        const config = JSON.parse(await readFile(settingsPath(), 'utf8'));
        for (const groups of Object.values(config.hooks) as { hooks: { timeout: number }[] }[][]) {
            for (const group of groups) {
                group.hooks[0]!.timeout = hookEntry('claude').timeout + 20;
            }
        }
        await writeFile(settingsPath(), JSON.stringify(config));

        const reports = await subject.set('claude', false);

        expect(reports).toEqual([{ path: settingsPath(), kind: 'hooks', outcome: 'kept-edited' }]);
        expect(await readFile(settingsPath(), 'utf8')).toContain('RUIMTE_HOOK_URL');
    });

    test('a file Ruimte created goes back to absent', async () => {
        const subject = integrations();
        await subject.load();
        await subject.set('claude', true);

        const reports = await subject.set('claude', false);

        expect(reports).toEqual([{ path: settingsPath(), kind: 'hooks', outcome: 'deleted' }]);
        expect(await exists(settingsPath())).toBe(false);
    });

    test('Codex hooks and rule go together, and an edited rules file is kept', async () => {
        const subject = integrations();
        await subject.load();
        await subject.set('codex', true);
        const rules = join(env.CODEX_HOME!, 'rules', 'ruimte.rules');
        expect(await readFile(rules, 'utf8')).toBe(CODEX_RULES);
        await writeFile(rules, `${CODEX_RULES}# mine\n`);

        const reports = await subject.set('codex', false);

        expect(reports).toEqual([
            { path: join(env.CODEX_HOME!, 'hooks.json'), kind: 'hooks', outcome: 'deleted' },
            { path: rules, kind: 'rules', outcome: 'kept-edited' }
        ]);
        expect(await exists(rules)).toBe(true);
    });

    test("Antigravity's rule joins a person's settings and leaves with only Ruimte's entries", async () => {
        const settings = join(env.GEMINI_HOME!, 'antigravity-cli', 'settings.json');
        await mkdir(dirname(settings), { recursive: true });
        await writeFile(settings, JSON.stringify({ theme: 'dark', permissions: { allow: ['command(git)'], deny: ['command(sudo)'] } }));
        const subject = integrations();
        await subject.load();

        const on = await subject.set('antigravity', true);
        const again = await subject.set('antigravity', true);

        expect(on).toEqual([{ path: settings, kind: 'rules', outcome: 'written' }]);
        expect(again).toEqual([{ path: settings, kind: 'rules', outcome: 'unchanged' }]);
        expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({
            theme: 'dark',
            permissions: { allow: ['command(git)', ...ANTIGRAVITY_RULES], deny: ['command(sudo)'] }
        });
        expect(await subject.files()).toContainEqual({ provider: 'antigravity', path: settings, kind: 'rules', present: true, ours: true });

        const off = await subject.set('antigravity', false);

        expect(off).toEqual([{ path: settings, kind: 'rules', outcome: 'removed' }]);
        expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({
            theme: 'dark',
            permissions: { allow: ['command(git)'], deny: ['command(sudo)'] }
        });
    });

    test('an Antigravity settings file Ruimte created goes back to absent', async () => {
        const settings = join(env.GEMINI_HOME!, 'antigravity-cli', 'settings.json');
        const subject = integrations();
        await subject.load();

        await subject.set('antigravity', true);
        expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({ permissions: { allow: [...ANTIGRAVITY_RULES] } });
        const off = await subject.set('antigravity', false);

        expect(off).toEqual([{ path: settings, kind: 'rules', outcome: 'deleted' }]);
        expect(await exists(settings)).toBe(false);
    });

    test('an Antigravity settings file whose permissions are not the shape agy reads is left alone', async () => {
        const settings = join(env.GEMINI_HOME!, 'antigravity-cli', 'settings.json');
        await mkdir(dirname(settings), { recursive: true });
        await writeFile(settings, '{"permissions":{"allow":"command(*)"}}');
        const subject = integrations();
        await subject.load();

        const reports = await subject.set('antigravity', true);

        expect(reports.map((report) => [report.kind, report.outcome])).toEqual([['rules', 'refused']]);
        expect(await readFile(settings, 'utf8')).toBe('{"permissions":{"allow":"command(*)"}}');
    });

    test('a CLI that is not on the machine is not asked about until it is installed', async () => {
        const found = new Set(['claude', 'codex']);
        const subject = new AgentIntegrations({ home, fixed: false, env, accountHomes: () => [], installed: async (kind) => found.has(kind) });
        await subject.load();
        let heard = 0;
        subject.onChanged(() => (heard += 1));
        expect(subject.summary().providers).toEqual([]);

        await subject.refreshInstalled();
        expect(subject.summary().providers.map((entry) => entry.provider)).toEqual(['claude', 'codex']);
        await subject.refreshInstalled();
        expect(heard).toBe(1);

        found.add('antigravity');
        await subject.refreshInstalled();

        expect(subject.summary().providers).toContainEqual({ provider: 'antigravity', state: 'unset', reviewed: false });
        expect(heard).toBe(2);
    });

    test('account homes are written and revoked with the provider', async () => {
        const account = join(root, 'account-claude');
        accountHomes = [account];
        const subject = integrations();
        await subject.load();

        const on = await subject.set('claude', true);
        const off = await subject.set('claude', false);

        expect(on.map((report) => [report.path, report.outcome])).toEqual([
            [settingsPath(), 'written'],
            [join(account, 'settings.json'), 'written']
        ]);
        expect(off.map((report) => [report.path, report.outcome])).toEqual([
            [settingsPath(), 'deleted'],
            [join(account, 'settings.json'), 'deleted']
        ]);
    });

    test('an account folder is only written while the provider is allowed', async () => {
        const account = join(root, 'account-claude');
        const subject = integrations();
        await subject.load();
        await subject.installFolder('claude', account);
        expect(await exists(account)).toBe(false);

        await subject.set('claude', true);
        await rm(account, { recursive: true, force: true });
        await subject.installFolder('claude', account);

        expect(await exists(join(account, 'settings.json'))).toBe(true);
    });

    test('a settings file that is not an object is refused and left alone', async () => {
        await writeFile(settingsPath(), '[]');
        const subject = integrations();
        await subject.load();

        const reports = await subject.set('claude', true);

        expect(reports.map((report) => report.outcome)).toEqual(['refused']);
        expect(await readFile(settingsPath(), 'utf8')).toBe('[]');
    });

    test('--no-hooks refuses a change in both directions and writes nothing', async () => {
        await installHooks(settingsPath(), 'claude');
        const before = await readFile(settingsPath(), 'utf8');
        const subject = integrations(true);
        await subject.load();

        await expect(subject.set('claude', true)).rejects.toBeInstanceOf(IntegrationsFixed);
        await expect(subject.set('claude', false)).rejects.toBeInstanceOf(IntegrationsFixed);
        await subject.installDefaults();

        expect(subject.summary().fixed).toBe(true);
        expect(subject.allows('claude')).toBe(false);
        expect(await readFile(settingsPath(), 'utf8')).toBe(before);
    });

    test("files lists what is there and what is Ruimte's", async () => {
        const subject = integrations();
        await subject.load();
        await subject.set('claude', true);

        const files = await subject.files();

        expect(files).toContainEqual({ provider: 'claude', path: settingsPath(), kind: 'hooks', present: true, ours: true });
        expect(files).toContainEqual({ provider: 'codex', path: join(env.CODEX_HOME!, 'hooks.json'), kind: 'hooks', present: false, ours: false });
    });

    test('listeners hear a change', async () => {
        const subject = integrations();
        await subject.load();
        let heard = 0;
        subject.onChanged(() => (heard += 1));

        await subject.set('codex', false);

        expect(heard).toBe(1);
    });
});
