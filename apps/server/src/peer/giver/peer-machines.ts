import { join } from 'node:path';
import { RecordDirectory } from '@adecore/agents';
import { BrokerUrlSchema, MachineIdSchema, PublicKeySchema } from '@ruimte/pulsar';
import { z } from 'zod';

const PeerMachineSchema = z.object({
    machineId: MachineIdSchema,
    // The key the account lists that machine with, taken from a statement the address book signed. A channel to it is pinned to this key.
    publicKey: PublicKeySchema,
    // Where that machine signals; absent is the broker this machine uses itself.
    brokerUrl: BrokerUrlSchema.nullable().optional().catch(undefined),
    linkedAt: z.number().int().nonnegative()
});

export type PeerMachine = z.infer<typeof PeerMachineSchema>;

/*
 * The machines this one has asked to work in, under `$RUIMTE_HOME/peer-machines`: what it needs to find
 * them again once the statement that let it in has run out. The key is pinned from a signed statement
 * and never from a client's word.
 */
export class PeerMachines {
    private readonly files: RecordDirectory<PeerMachine>;

    constructor(home: string) {
        this.files = new RecordDirectory({ dir: join(home, 'peer-machines'), schema: PeerMachineSchema, idOf: (file) => file.machineId });
    }

    load(): Promise<void> {
        return this.files.load();
    }

    get(machineId: string): PeerMachine | null {
        return this.files.get(machineId) ?? null;
    }

    all(): PeerMachine[] {
        return this.files.all();
    }

    /* Another key for a machine that is known replaces the old one, as a new statement from the address book says so. */
    async put(machine: Omit<PeerMachine, 'linkedAt'>, now: number): Promise<PeerMachine> {
        const held = this.files.get(machine.machineId);
        const next = { ...held, ...machine, linkedAt: held?.linkedAt ?? now };
        await this.files.write(next);
        return next;
    }

    /* Every machine, as leaving the account forgets them. */
    async wipe(): Promise<void> {
        for (const machine of this.files.all()) {
            await this.files.remove(machine.machineId);
        }
    }

    remove(machineId: string): Promise<void> {
        return this.files.remove(machineId);
    }
}
