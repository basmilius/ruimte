import { defineServer, defineTerminalProfile, storage, terminals } from '@ruimte/extension/server';
import { SERVICES, serviceNamed, type Service } from './service';

export const SHELL_PROFILE = 'service-shell';

/* The key of the service a project's shells open in, which the client's card writes as `machine` storage. */
export function serviceKey(projectId: string): string {
    return `service:${projectId}`;
}

async function serviceOf(projectId: string): Promise<Service> {
    return serviceNamed(await storage.get<string>(serviceKey(projectId)));
}

/* What a person reads first in a shell Harbor opened: which service it stands in. */
export function greeting(service: Service): string {
    return `echo "Harbor: $HARBOR_SERVICE (${service.image})"\n`;
}

// No engine runs here, so the shell "in a service" is a local one that only knows the service by name.
defineTerminalProfile({
    id: SHELL_PROFILE,
    title: 'Harbor shell',
    icon: 'container',
    spawn: async ({ project }) => {
        const service = await serviceOf(project.id);

        return { command: 'sh', env: { HARBOR_SERVICE: service.name, HARBOR_WORKDIR: service.workdir } };
    }
});

const api = defineServer({
    async services() {
        return SERVICES;
    },
    /* A shell in the project's service as a view of its own, with its first command typed. */
    async openShell(projectId: string) {
        const service = await serviceOf(projectId);
        const opened = await terminals.open({ project: { id: projectId }, profile: SHELL_PROFILE, title: `Harbor: ${service.name}` });

        if (!opened.ok) {
            throw new Error(opened.error.message);
        }

        const typed = await terminals.write(opened.value, greeting(service));

        if (!typed.ok) {
            throw new Error(typed.error.message);
        }

        return opened.value;
    },
    /* Types into any terminal it is handed, which the machine only lets through for one Harbor opened. */
    async type(terminalId: string, text: string) {
        const typed = await terminals.write({ id: terminalId }, text);

        return typed.ok ? null : typed.error;
    }
});

export type HarborServer = typeof api;
export default api;
