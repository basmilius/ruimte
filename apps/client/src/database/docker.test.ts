import { describe, expect, test } from 'bun:test';
import type { DockerContainer } from '@adecore/database/protocol';
import { containerConnection, containersFor, containerTitle } from './docker.ts';

function container(name: string, project: string | null = null, extra: Partial<DockerContainer> = {}): DockerContainer {
    return {
        id: name,
        name,
        image: 'mariadb:11',
        engine: 'mysql',
        ports: [{ container: 3306, host: 3306 }],
        project,
        service: project === null ? null : 'db',
        suggested: { user: 'root', password: 'password', database: 'shop' },
        ...extra
    };
}

describe('database containers', () => {
    test('the project’s own Compose project comes first, and a file engine is left out', () => {
        const list = [
            container('MariaDB-server'),
            container('other-db-1', 'other'),
            container('ruimte-db-1', 'ruimte'),
            container('lite', null, { engine: 'sqlite' })
        ];
        expect(containersFor(list, 'Ruimte').map((entry) => entry.name)).toEqual(['ruimte-db-1', 'MariaDB-server', 'other-db-1']);
        expect(containersFor(list, null).map((entry) => entry.name)).toEqual(['MariaDB-server', 'other-db-1', 'ruimte-db-1']);
    });

    test('a connection is named after the Compose service or the container, with the credentials it suggests', () => {
        expect(containerTitle(container('ruimte-db-1', 'ruimte'))).toBe('ruimte/db');
        const connection = containerConnection('id-1', container('MariaDB-server'));
        expect(connection).toEqual({
            id: 'id-1',
            name: 'MariaDB-server',
            shared: false,
            config: {
                engine: 'mysql',
                host: '127.0.0.1',
                port: 3306,
                user: 'root',
                password: 'password',
                database: 'shop',
                tls: 'prefer',
                readOnly: false,
                tunnel: { kind: 'docker', container: 'MariaDB-server', port: 3306 }
            }
        });
    });

    test('a container that lists another port is reached on that one', () => {
        const odd = containerConnection('id-2', container('odd', null, { ports: [{ container: 3307, host: null }], suggested: {} }));
        expect(odd.config).toMatchObject({ user: '', password: '', tunnel: { port: 3307 } });
        expect(odd.config).not.toHaveProperty('database');
    });
});
