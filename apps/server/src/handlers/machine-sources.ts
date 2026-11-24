import type { Area } from '../area.ts';
import type { MachineSources } from '../extensions/machine-sources.ts';

interface MachineSourcesDeps {
    sources: MachineSources;
}

/*
 * The machine sources of extensions, apart from `extensionsArea` since they hold something for a client. Owner only,
 * all three: a start runs programs on this machine, so the yes to it comes from the app on this machine and from nobody
 * a statement let in. What a start writes holds the page and the code that put a machine on the account, which is why
 * only a client that asked for the list hears it.
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
        }
    };
}
