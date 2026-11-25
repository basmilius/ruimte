/*
 * `harbor.yaml` in a project folder: the services Harbor lists as launches, and the machine it can start. A format of its own, read without a
 * dependency. Two spaces of indentation name a service, four give it a field:
 *
 *     services:
 *       web:
 *         command: bun run dev
 *         port: 5173
 *       migrate:
 *         command: bun run migrate
 *         kind: task
 *         workdir: api
 */

export const COMPOSE_FILE = 'harbor.yaml';

export interface ComposeService {
    name: string;
    command: string;
    /* A service stays up; a task runs to its end. */
    kind: 'service' | 'task';
    port?: number;
    /* A folder of the project the command runs in. */
    workdir?: string;
}

// What a launch of a source is named by, so a service with another name is no launch.
const SERVICE_NAME = /^ {2}([a-z0-9][a-z0-9-]{0,63}):\s*$/;
const FIELD = /^ {4}([a-z]+):\s*(.+?)\s*$/;

/* The services of a compose file, in its order. One without a command starts nothing, so it is left out. */
export function servicesIn(text: string): ComposeService[] {
    const services: Partial<ComposeService>[] = [];
    // The service the fields that follow belong to; none under a name that is no service.
    let service: Partial<ComposeService> | null = null;
    let inServices = false;

    for (const line of text.split(/\r?\n/)) {
        if (line.trim() === '' || line.trimStart().startsWith('#')) {
            continue;
        }

        if (!line.startsWith(' ')) {
            inServices = line.trim() === 'services:';

            continue;
        }

        if (!inServices) {
            continue;
        }

        const field = FIELD.exec(line);

        if (!line.startsWith('    ')) {
            const name = SERVICE_NAME.exec(line)?.[1];

            service = name === undefined ? null : { name, kind: 'service' };

            if (service !== null) {
                services.push(service);
            }
        } else if (field !== null && service !== null) {
            const [, key, value] = field as unknown as [string, string, string];

            if (key === 'command') {
                service.command = value;
            } else if (key === 'workdir') {
                service.workdir = value;
            } else if (key === 'kind' && value === 'task') {
                service.kind = 'task';
            } else if (key === 'port' && /^\d{1,5}$/.test(value)) {
                service.port = Number(value);
            }
        }
    }

    return services.filter((service): service is ComposeService => service.command !== undefined);
}

/*
 * The place `harbor.yaml` names for a machine, under a `machine:` of its own beside `services:`. Its fields sit at two
 * spaces, and each command is a plain shell line this computer runs:
 *
 *     machine:
 *       name: workbench
 *       image: harbor/workbench:1
 *       prepare: sh scripts/prepare.sh
 *       start: sh scripts/start.sh
 *       inside: sh scripts/inside.sh
 */
export interface ComposeMachine {
    name: string;
    image?: string;
    /* Runs before the start, such as building what the machine runs in. */
    prepare?: string;
    /* Puts the machine there and starts it. */
    start: string;
    /* Runs what follows it where the machine lives, as an engine's `exec` would. With it, Ruimte has the new machine join the person's account. */
    inside?: string;
}

const MACHINE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MACHINE_FIELD = /^ {2}([a-z]+):\s*(.+?)\s*$/;

/* The machine of a compose file, or null for a file without one, one without a name Ruimte takes or one that starts nothing. */
export function machineIn(text: string): ComposeMachine | null {
    const fields = new Map<string, string>();
    let inMachine = false;

    for (const line of text.split(/\r?\n/)) {
        if (line.trim() === '' || line.trimStart().startsWith('#')) {
            continue;
        }

        if (!line.startsWith(' ')) {
            inMachine = line.trim() === 'machine:';

            continue;
        }

        const field = inMachine ? MACHINE_FIELD.exec(line) : null;

        if (field !== null) {
            fields.set(field[1] ?? '', field[2] ?? '');
        }
    }

    const name = fields.get('name');
    const start = fields.get('start');

    if (name === undefined || start === undefined || !MACHINE_NAME.test(name)) {
        return null;
    }

    const optional = (key: 'image' | 'prepare' | 'inside'): Partial<ComposeMachine> => (fields.has(key) ? { [key]: fields.get(key) } : {});

    return { name, start, ...optional('image'), ...optional('prepare'), ...optional('inside') };
}

/* A digest of the whole file: any change to it, also to a comment, has a person look at the launches again. */
export async function fingerprintOf(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
