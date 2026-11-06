import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OpenAiCredentialStatus } from '@ruimte/desktop-bridge';
import type { SecretStore } from '../secret-store';

/* The copy of the OpenAI key the app's own daemon keeps for Voice; each says whether the daemon took it. */
export interface MachineVoiceKey {
    hand(key: string): Promise<boolean>;
    clear(): Promise<boolean>;
}

/* Whether a removal the machine has not taken yet is owed; on disk, so a restart of the app still owes it. */
export interface PendingRemoval {
    owed(): Promise<boolean>;
    set(owed: boolean): Promise<void>;
}

export interface VoiceKey {
    status(): Promise<OpenAiCredentialStatus>;
    save(key: string): Promise<OpenAiCredentialStatus>;
    remove(): Promise<OpenAiCredentialStatus>;
    /* Gives the machine the saved key, or takes its copy away when a removal is still owed. */
    handOver(): Promise<void>;
}

export const MACHINE_STILL_HOLDS_KEY = 'This machine still holds the key for Voice. Try again once it runs.';

export function pendingRemovalFile(path: string): PendingRemoval {
    return {
        owed: () =>
            stat(path).then(
                () => true,
                () => false
            ),
        async set(owed) {
            if (!owed) {
                await rm(path, { force: true });
                return;
            }

            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, '', { mode: 0o600 });
        }
    };
}

/*
 * The OpenAI key in the shell and the machine's copy of it. A removal the machine did not take stays
 * owed until it does, so a key a person removed never keeps paying for Voice on the machine.
 */
export function voiceKey(keys: () => SecretStore, pending: PendingRemoval, machine: MachineVoiceKey | null): VoiceKey {
    // Asks the machine again; true once nothing is owed any more.
    const settleRemoval = async (): Promise<boolean> => {
        if (machine === null || !(await pending.owed())) {
            return true;
        }

        if (!(await machine.clear())) {
            return false;
        }

        await pending.set(false);

        return true;
    };

    const status = async (): Promise<OpenAiCredentialStatus> => {
        const store = keys();

        if ((await store.read()) !== null) {
            return { configured: true, persistent: store.persistent() };
        }

        return (await settleRemoval()) ? { configured: false, persistent: false } : { configured: false, persistent: false, machineKeyLeft: true };
    };

    const handOver = async (): Promise<void> => {
        if (machine === null) {
            return;
        }

        const key = await keys().read();

        if (key === null) {
            await settleRemoval();
            return;
        }

        await machine.hand(key);
    };

    return {
        status,
        handOver,
        async save(key) {
            await keys().write(key);
            // The key handed over next takes the place of the copy that was owed a removal.
            await pending.set(false);
            await handOver();

            return status();
        },
        async remove() {
            /* Owed before the shell's copy goes, so a crash in between still takes the machine's copy. Also
               owed outside machine mode `local`: the next start that runs the machine takes its copy then. */
            await pending.set(true);
            await keys().write(null);

            if (!(await settleRemoval())) {
                throw new Error(MACHINE_STILL_HOLDS_KEY);
            }

            return status();
        }
    };
}
