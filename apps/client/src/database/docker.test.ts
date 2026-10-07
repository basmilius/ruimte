import { describe, expect, test } from 'bun:test';
import type { DockerContainer } from '@adecore/database/protocol';
import { containersFor } from './docker.ts';

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
});
