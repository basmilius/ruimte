import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import { endpointById } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { TransportError, type Transport } from '@/transport/transport';

export interface TerminalPrepareMachine {
    machineId(endpointId: string): string | null;
    transport(endpointId: string): Transport | null;
}

export function terminalPrepareActions(
    machine: TerminalPrepareMachine = {
        machineId: (endpointId) => endpointById(endpointId)?.daemonId ?? null,
        transport: transportFor
    }
): ActionHandlers<void> {
    const connected = (endpointId: string, machineId: string): Transport => {
        const transport = machine.transport(endpointId);
        if (!transport || transport.status !== 'open' || machine.machineId(endpointId) !== machineId) {
            throw new ActionRefusal('wrong-machine', 'The machine of this chat is not connected.');
        }
        return transport;
    };
    return {
        'terminal.preparePreview': async ({ endpointId, machineId, ...source }) => {
            const transport = connected(endpointId, machineId);
            const output = await transport.request('session.preparePreview', { machineId, ...source });
            if (connected(endpointId, machineId) !== transport || output.machineId !== machineId) {
                throw new ActionRefusal('wrong-machine', 'The machine changed while the preview was loading.');
            }
            return { output };
        },
        'terminal.prepare': async ({ endpointId, machineId, token }) => {
            const transport = connected(endpointId, machineId);
            try {
                return { output: await transport.request('session.prepare', { machineId, token }) };
            } catch (error) {
                if (
                    error instanceof TransportError &&
                    ['terminal-prepare-refused', 'terminal-editor-refused', 'terminal-prepare-unconfirmed'].includes(error.code)
                ) {
                    throw new ActionRefusal(error.code, error.message);
                }
                // Once dispatched, a broken reply cannot establish whether the editor inserted the line.
                throw new ActionRefusal(
                    'terminal-prepare-unconfirmed',
                    'Preparation was not confirmed. The command may have been inserted. Check the terminal before preparing again.'
                );
            }
        }
    };
}
