/*
 * `harbor.yaml` in a project folder: the services Harbor lists as launches. A format of its own, read without a
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

/* A digest of the whole file: any change to it, also to a comment, has a person look at the launches again. */
export async function fingerprintOf(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
