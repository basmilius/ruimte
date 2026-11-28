import type { Area } from '../area.ts';
import type { MachineSources } from '../extensions/machine-sources.ts';

interface MachineSourcesDeps {
    sources: MachineSources;
}

/*
 * The machine sources of extensions, apart from `extensionsArea` since they hold something for a client. Owner only,
 * all of them: a start runs programs on this machine and puts the machine it starts on this machine's account, so the
 * yes to it comes from the app on this machine and from nobody a statement let in. The registration the new machine
 * signed goes to the owner alone for the same reason: whoever holds it can post it.
 */
export function machineSourcesArea({ sources }: MachineSourcesDeps): Area {
    return {
        name: 'extensionMachines',
        sources: [sources],
        holders: [sources],
        handlers: (dispatcher) => {
            dispatcher.register('extension.machineList', async (payload, client) => ({ candidates: await sources.list(payload.projectId, client.id) }), {
                owner: true
            });

            dispatcher.register('extension.machineStart', async ({ approve, ...target }) => ({ candidate: await sources.start(target, approve) }), {
                owner: true
            });

            dispatcher.register(
                'extension.machineStop',
                (target) => {
                    sources.stop(target);

                    return {};
                },
                { owner: true }
            );

            dispatcher.register(
                'extension.machineRegistration',
                async ({ accountId, ...target }) => ({ registration: await sources.registration(target, accountId) }),
                { owner: true }
            );

            dispatcher.register(
                'extension.machineJoined',
                (target) => {
                    sources.joined(target);

                    return {};
                },
                { owner: true }
            );
        }
    };
}
