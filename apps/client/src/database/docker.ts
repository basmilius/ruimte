import type { DockerContainer } from '@adecore/database/protocol';
import type { DatabaseConnection } from '@ruimte/contracts';

const MYSQL_PORT = 3306;

/* What names a container to a person: its Compose `project/service`, else its own name. */
export function containerTitle(container: DockerContainer): string {
    return container.project !== null && container.service !== null ? `${container.project}/${container.service}` : container.name;
}

/* The port inside the container: MySQL's own when it lists that one or none, else the first it lists. */
function containerPort(container: DockerContainer): number {
    const ports = container.ports.map((entry) => entry.container);
    return ports.length === 0 || ports.includes(MYSQL_PORT) ? MYSQL_PORT : ports[0]!;
}

/* A new connection to a container with the credentials its environment sets, private until a person shares it. */
export function containerConnection(id: string, container: DockerContainer): DatabaseConnection {
    const { user, password, database } = container.suggested;
    return {
        id,
        name: containerTitle(container),
        shared: false,
        config: {
            engine: 'mysql',
            host: '127.0.0.1',
            port: MYSQL_PORT,
            user: user ?? '',
            password: password ?? '',
            ...(database === undefined ? {} : { database }),
            tls: 'prefer',
            readOnly: false,
            tunnel: { kind: 'docker', container: container.name, port: containerPort(container) }
        }
    };
}

/* A folder's name the way Compose makes a project name of it. */
function composeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/*
 * The containers a project can add, its own first: those whose Compose project is named after the
 * project folder. A container of a file engine is none a server connection can point at.
 */
export function containersFor(containers: readonly DockerContainer[], folderName: string | null): DockerContainer[] {
    const own = folderName === null ? '' : composeName(folderName);
    const ours = (container: DockerContainer): boolean => own !== '' && container.project !== null && composeName(container.project) === own;
    const servers = containers.filter((container) => container.engine !== 'sqlite');
    return [...servers.filter(ours), ...servers.filter((container) => !ours(container))];
}
