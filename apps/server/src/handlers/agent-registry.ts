import { RequestError, type Dispatcher } from '../dispatcher.ts';
import { errorText } from '../error-text.ts';
import type { CliVersions } from '../providers/cli-versions.ts';
import type { RegistryAgents } from '../providers/registry-agents.ts';

/*
 * The agents of the ACP registry and the versions of the CLIs. Installing an agent or updating a CLI downloads a program
 * and makes it runnable on this machine, so only the local secret may press either; any client the machine let in may
 * see the catalog and the versions.
 */
export function registerAgentRegistryHandlers(dispatcher: Dispatcher, agents: RegistryAgents, versions: CliVersions): void {
    dispatcher.register('provider.registry', async (payload) => ({ catalog: await agents.catalog(payload.refresh === true) }));

    dispatcher.register('provider.installAgent', async (payload) => ({ agent: await refusing('agent-install-failed', () => agents.install(payload.id)) }), {
        owner: true
    });

    dispatcher.register('provider.removeAgent', async (payload) => ({ agent: await refusing('agent-remove-failed', () => agents.remove(payload.id)) }), {
        owner: true
    });

    dispatcher.register('provider.versions', async (payload) => ({
        versions:
            payload.provider === undefined
                ? await versions.list(payload.refresh === true)
                : [await refusing('unknown-cli', () => versions.one(payload.provider!, payload.refresh === true))]
    }));

    dispatcher.register('provider.update', async (payload) => ({ version: await refusing('cli-update-failed', () => versions.update(payload.provider)) }), {
        owner: true
    });
}

async function refusing<T>(code: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (e) {
        throw new RequestError(code, errorText(e));
    }
}
