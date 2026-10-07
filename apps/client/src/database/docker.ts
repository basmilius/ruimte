import { isMysqlContainer } from '@adecore/database';
import type { DockerContainer } from '@adecore/database/protocol';

/* A folder's name the way Compose makes a project name of it. */
function composeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/* The containers a project can add, its own first: those whose Compose project is named after the project folder. */
export function containersFor(containers: readonly DockerContainer[], folderName: string | null): DockerContainer[] {
    const own = folderName === null ? '' : composeName(folderName);
    const ours = (container: DockerContainer): boolean => own !== '' && container.project !== null && composeName(container.project) === own;
    const servers = containers.filter(isMysqlContainer);
    return [...servers.filter(ours), ...servers.filter((container) => !ours(container))];
}
