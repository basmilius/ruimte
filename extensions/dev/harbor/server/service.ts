/*
 * The Harbor service, as this extension would reach a container engine: the services of a project's compose file, as
 * fixed data. No engine runs and nothing is read from the project folder.
 */
import type { ServiceName } from '../shared/services';

export interface Service {
    // One of the names `client/` offers, so a service added here without its name there fails the check.
    name: ServiceName;
    image: string;
    /* The folder inside the container a shell starts in. */
    workdir: string;
}

export const SERVICES: readonly Service[] = [
    { name: 'web', image: 'harbor/web:4.2', workdir: '/app' },
    { name: 'api', image: 'harbor/api:4.2', workdir: '/srv/api' },
    { name: 'db', image: 'harbor/postgres:18', workdir: '/var/lib/postgresql' }
];

export function serviceNamed(name: string | undefined): Service {
    return SERVICES.find((service) => service.name === name) ?? (SERVICES[0] as Service);
}
