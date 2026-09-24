import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';
import { helperDirectory } from './helper.ts';

const SettingsSchema = z.object({
    enabled: z.boolean().catch(false),
    language: z.string().optional().catch(undefined)
});
type Settings = z.infer<typeof SettingsSchema>;

const AppEntrySchema = z.object({ bundleId: z.string().min(1), name: z.string(), at: z.number() });

const GrantsSchema = z.object({
    always: z.array(AppEntrySchema).catch([]),
    // Apps once seen running a shell: an agent is refused them even while no shell of theirs runs.
    terminals: z.array(AppEntrySchema).catch([])
});
type Grants = z.infer<typeof GrantsSchema>;

const readJson = async <Schema extends z.ZodType>(path: string, schema: Schema, fallback: z.infer<Schema>): Promise<z.infer<Schema>> => {
    try {
        const parsed = schema.safeParse(JSON.parse(await readFile(path, 'utf8')));
        return parsed.success ? parsed.data : fallback;
    } catch (error) {
        if (isNotFound(error) || error instanceof SyntaxError) {
            return fallback;
        }
        throw error;
    }
};

/*
 * What a person decided about computer use on this machine: whether it is on, and which apps an
 * agent may operate without asking. Under `$RUIMTE_HOME`, beside the helper's own files, and never
 * in a project: no verb writes here, and a project file an agent can rewrite must not grant anything.
 */
export class ComputerUseStore {
    private readonly directory: string;
    private readonly now: () => number;
    private settings: Settings = { enabled: false };
    private grants: Grants = { always: [], terminals: [] };

    constructor(home: string, now: () => number = Date.now) {
        this.directory = helperDirectory(home);
        this.now = now;
    }

    async load(): Promise<void> {
        this.settings = await readJson(this.settingsPath, SettingsSchema, { enabled: false });
        this.grants = await readJson(this.grantsPath, GrantsSchema, { always: [], terminals: [] });
    }

    get enabled(): boolean {
        return this.settings.enabled;
    }

    get language(): string | undefined {
        return this.settings.language;
    }

    async setEnabled(enabled: boolean, language: string | undefined): Promise<void> {
        this.settings = { enabled, language: language ?? this.settings.language };
        await this.write(this.settingsPath, this.settings);
    }

    async setLanguage(language: string): Promise<void> {
        this.settings = { ...this.settings, language };
        await this.write(this.settingsPath, this.settings);
    }

    alwaysAllowed(bundleId: string): boolean {
        return this.grants.always.some((entry) => entry.bundleId === bundleId);
    }

    async allowAlways(bundleId: string, name: string): Promise<void> {
        if (this.alwaysAllowed(bundleId)) {
            return;
        }
        this.grants = { ...this.grants, always: [...this.grants.always, { bundleId, name, at: this.now() }] };
        await this.write(this.grantsPath, this.grants);
    }

    knownTerminal(bundleId: string): boolean {
        return this.grants.terminals.some((entry) => entry.bundleId === bundleId);
    }

    async rememberTerminal(bundleId: string, name: string): Promise<void> {
        if (this.knownTerminal(bundleId)) {
            return;
        }
        this.grants = { ...this.grants, terminals: [...this.grants.terminals, { bundleId, name, at: this.now() }] };
        await this.write(this.grantsPath, this.grants);
    }

    private get settingsPath(): string {
        return join(this.directory, 'settings.json');
    }

    private get grantsPath(): string {
        return join(this.directory, 'grants.json');
    }

    private async write(path: string, value: unknown): Promise<void> {
        // The helper keeps its socket and screenshots here and expects the folder to be this user's alone.
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`, 0o600);
    }
}
