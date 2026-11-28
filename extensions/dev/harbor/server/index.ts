import {
    defineLaunchSource,
    defineMachineSource,
    defineServer,
    defineTerminalProfile,
    emit,
    files,
    log,
    onEvent,
    projectSettings,
    terminals,
    type ProjectRef,
    type SpawnDescription
} from '@ruimte/extension/server';
import { COMPOSE_FILE, fingerprintOf, machineIn, servicesIn, type ComposeMachine, type ComposeService } from './compose';
import { SERVICES, serviceNamed, type Service } from './service';

export const SHELL_PROFILE = 'service-shell';
export const COMPOSE_SOURCE = 'compose';
export const MACHINE_SOURCE = 'compose-machine';

/* The field of the project's settings that holds the service its shells open in, which `client/` defines. */
export const SERVICE_SETTING = 'service';

async function serviceOf(projectId: string): Promise<Service> {
    return serviceNamed(await projectSettings.get<string>({ id: projectId }, SERVICE_SETTING));
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

async function composeOf(project: ProjectRef): Promise<{ services: ComposeService[]; fingerprint: string } | null> {
    const read = await files.readText(project, COMPOSE_FILE);

    return read.ok ? { services: servicesIn(read.value), fingerprint: await fingerprintOf(read.value) } : null;
}

/*
 * Each service of the project's `harbor.yaml` as a launch. Harbor only describes it: Ruimte asks the person before the
 * first start and again after the file changed, and runs the command in a session of its own.
 */
defineLaunchSource({
    id: COMPOSE_SOURCE,
    title: 'Harbor',
    async list(project) {
        const compose = await composeOf(project);

        return (compose?.services ?? []).map((service) => ({
            id: service.name,
            name: service.name,
            kind: service.kind,
            spawn: {
                command: 'sh',
                args: ['-c', service.command],
                env: { HARBOR_SERVICE: service.name },
                ...(service.workdir === undefined ? {} : { cwd: service.workdir })
            },
            fingerprint: compose?.fingerprint ?? '',
            ...(service.port === undefined ? {} : { port: service.port })
        }));
    },
    async watch(project, changed) {
        const watching = await files.watch(project, COMPOSE_FILE, changed);

        if (!watching.ok) {
            log.error(`Harbor does not follow ${COMPOSE_FILE}: ${watching.error.message}`);
        }

        return watching.ok ? watching.value : () => undefined;
    }
});

async function machineOf(project: ProjectRef): Promise<{ machine: ComposeMachine; fingerprint: string } | null> {
    const read = await files.readText(project, COMPOSE_FILE);
    const machine = read.ok ? machineIn(read.value) : null;

    return read.ok && machine !== null ? { machine, fingerprint: await fingerprintOf(read.value) } : null;
}

function shell(line: string, machine: ComposeMachine): SpawnDescription {
    return { command: 'sh', args: ['-c', line], env: { HARBOR_MACHINE: machine.name } };
}

// No engine runs here, so "inside" is this computer: the line gets what Ruimte appends as its own arguments.
function inside(line: string, machine: ComposeMachine): SpawnDescription {
    return { command: 'sh', args: ['-c', `${line} "$@"`, 'harbor'], env: { HARBOR_MACHINE: machine.name } };
}

/*
 * The machine of the project's `harbor.yaml` as a place Ruimte can start one in. Harbor describes the shell lines of
 * the file and never runs them, and it has no engine to ask, so it cannot tell whether a machine already runs there.
 * The file's `inside` is how a command gets to where the machine lives. Ruimte appends its own command to it to have
 * the new machine join the person's account: Harbor names no account and sees neither that command nor its answer.
 */
defineMachineSource({
    id: MACHINE_SOURCE,
    title: 'Harbor',
    async list(project) {
        const found = await machineOf(project);

        return found === null ? [] : [{ id: found.machine.name, title: found.machine.name, place: found.machine.image ?? COMPOSE_FILE, running: false }];
    },
    async start(candidate, { project, report }) {
        report(`Reading ${COMPOSE_FILE}`);

        const found = await machineOf(project);

        if (found === null || found.machine.name !== candidate.id) {
            throw new Error(`${COMPOSE_FILE} no longer names the machine ${candidate.id}`);
        }

        const { machine, fingerprint } = found;

        return {
            steps: [
                ...(machine.prepare === undefined ? [] : [{ title: `Prepare ${machine.name}`, spawn: shell(machine.prepare, machine) }]),
                { title: `Start ${machine.name}`, spawn: shell(machine.start, machine) }
            ],
            ...(machine.inside === undefined ? {} : { inside: inside(machine.inside, machine) }),
            fingerprint
        };
    }
});

// The services that run, per project, by the launch each runs as.
const running = new Map<string, Set<string>>();

/* The service a launch of this source runs, read off the id Ruimte lists it under. */
function serviceOfLaunch(launch: string): string | null {
    const prefix = `dev.harbor:${COMPOSE_SOURCE}:`;

    return launch.startsWith(prefix) ? launch.slice(prefix.length) : null;
}

onEvent('launch.status', ({ project, launch, state }) => {
    const service = serviceOfLaunch(launch);

    if (service === null) {
        return;
    }

    const services = running.get(project.id) ?? new Set<string>();

    if (state === 'exited') {
        services.delete(service);
    } else {
        services.add(service);
    }

    running.set(project.id, services);
    emit('harbor.running', { projectId: project.id, services: [...services] });
});

const api = defineServer({
    async services() {
        return SERVICES;
    },
    /* The services of the project's compose file that run now, as their launches say. */
    async running(projectId: string) {
        return [...(running.get(projectId) ?? [])];
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
