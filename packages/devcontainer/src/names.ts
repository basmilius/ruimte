// A direct connection gets ten ports of its own per container, in one of 500 blocks from this port up.
const FIRST_PORT = 44_000;
const PORT_BLOCKS = 500;
const PORTS = 10;

/* What Dev Containers calls everything it makes for one project folder, so a second start finds the same again. */
export interface ContainerNames {
    container: string;
    /* The tag of the image built from the project's Dockerfile. */
    image: string;
    /* The volume with the machine's state: its id and keys, its account and its projects. */
    machineVolume: string;
    /* The volume the agent CLIs keep their sign-in in. */
    loginVolume: string;
    /* The UDP ports of a direct connection, the same in the container as on this computer. */
    ports: { first: number; last: number };
}

export async function sha256(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/*
 * The names for a project folder. The folder's own name is there for a person to read, and a piece of the digest of
 * its whole path keeps two folders with the same name apart.
 */
export async function namesOf(folder: string): Promise<ContainerNames> {
    const last = folder.split(/[\\/]/).findLast((part) => part !== '') ?? '';
    const readable =
        last
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 32)
            .replace(/-+$/, '') || 'project';
    const digest = (await sha256(folder)).slice(0, 8);
    const container = `ruimte-devcontainer-${readable}-${digest}`;
    const first = FIRST_PORT + (Number.parseInt(digest, 16) % PORT_BLOCKS) * PORTS;

    return {
        container,
        image: container,
        machineVolume: `${container}-machine`,
        loginVolume: `${container}-logins`,
        ports: { first, last: first + PORTS - 1 }
    };
}
