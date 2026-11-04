import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Serializer } from '@adecore/utils/async';
import { isNotFound } from '@adecore/utils/errors';
import { writeAtomic } from '@adecore/utils/fs';
import { isRecord } from '@adecore/utils/record';
import { isSecretReference } from '@ruimte/contracts';

const SECRETS_DIR = 'secrets';

const SECRETS_VERSION = 1;

interface StoredSecret {
    launchId: string;
    variable: string;
    value: string;
}

interface SecretsFile {
    version: number;
    projectId: string;
    secrets: StoredSecret[];
}

export interface SecretSlot {
    launchId: string;
    variable: string;
}

function sameSlot(left: SecretSlot, right: SecretSlot): boolean {
    return left.launchId === right.launchId && left.variable === right.variable;
}

function isStoredSecret(value: unknown): value is StoredSecret {
    return isRecord(value) && typeof value.launchId === 'string' && typeof value.variable === 'string' && typeof value.value === 'string';
}

/*
 * The secrets a person typed into a card, one file per project under `$RUIMTE_HOME/secrets`, keyed on
 * launch and variable. Files are 0600 in a 0700 folder and replaced whole, so a crash leaves the old
 * file or the new one. Nothing here is a client's to read: `MachineHome` refuses the folder, no tool
 * reads it, and the only reader is the start of a launch, which puts a value into that process's
 * environment and nowhere else.
 */
export class SecretStore {
    private readonly dir: string;
    private readonly writes = new Serializer();

    constructor(home: string) {
        this.dir = join(home, SECRETS_DIR);
    }

    /* A file name no project id can steer outside the folder. */
    pathOf(projectId: string): string {
        return join(this.dir, `${createHash('sha256').update(projectId).digest('hex').slice(0, 32)}.json`);
    }

    has(projectId: string, slot: SecretSlot): Promise<boolean> {
        return this.writes.run(async () => (await this.load(projectId)).some((entry) => sameSlot(entry, slot)));
    }

    write(projectId: string, slot: SecretSlot, value: string): Promise<void> {
        return this.writes.run(async () => {
            const secrets = (await this.load(projectId)).filter((entry) => !sameSlot(entry, slot));
            await this.store(projectId, [...secrets, { launchId: slot.launchId, variable: slot.variable, value }]);
        });
    }

    remove(projectId: string, slot: SecretSlot): Promise<void> {
        return this.writes.run(async () => {
            const secrets = await this.load(projectId);
            if (secrets.some((entry) => sameSlot(entry, slot))) {
                await this.store(
                    projectId,
                    secrets.filter((entry) => !sameSlot(entry, slot))
                );
            }
        });
    }

    /* Drops every secret of the project no launch refers to any more, after a person's save of the launches. */
    retain(projectId: string, referenced: readonly SecretSlot[]): Promise<void> {
        return this.writes.run(async () => {
            const secrets = await this.load(projectId);
            const kept = secrets.filter((entry) => referenced.some((slot) => sameSlot(entry, slot)));
            if (kept.length !== secrets.length) {
                await this.store(projectId, kept);
            }
        });
    }

    /*
     * The environment a launch's process starts with: every reference swapped for its secret. A
     * reference with no secret behind it is left out, so the process sees the variable unset rather
     * than the marker.
     */
    resolveEnv(projectId: string, launchId: string, env: Readonly<Record<string, string>>): Promise<Record<string, string>> {
        if (!Object.values(env).some(isSecretReference)) {
            return Promise.resolve({ ...env });
        }
        return this.writes.run(async () => {
            const secrets = await this.load(projectId);
            const resolved: Record<string, string> = {};
            for (const [variable, value] of Object.entries(env)) {
                if (!isSecretReference(value)) {
                    resolved[variable] = value;
                    continue;
                }
                const secret = secrets.find((entry) => sameSlot(entry, { launchId, variable }));
                if (secret) {
                    resolved[variable] = secret.value;
                }
            }
            return resolved;
        });
    }

    private async load(projectId: string): Promise<StoredSecret[]> {
        let text: string;
        try {
            text = await readFile(this.pathOf(projectId), 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return [];
            }
            throw e;
        }
        try {
            const file = JSON.parse(text) as Partial<SecretsFile>;
            return Array.isArray(file.secrets) ? file.secrets.filter(isStoredSecret) : [];
        } catch {
            // Neither the text nor the parser's message, which quotes it: both hold values.
            console.warn(`The secrets file ${this.pathOf(projectId)} is not JSON and counts as empty`);
            return [];
        }
    }

    private async store(projectId: string, secrets: StoredSecret[]): Promise<void> {
        const path = this.pathOf(projectId);
        if (secrets.length === 0) {
            await rm(path, { force: true });
            return;
        }
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        const file: SecretsFile = { version: SECRETS_VERSION, projectId, secrets };
        await writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`, 0o600, { durable: true });
    }
}
