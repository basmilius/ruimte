import { parseJsonc } from './jsonc';

/* Where a project keeps the file, the first that exists. */
export const DEVCONTAINER_FILES: readonly string[] = ['.devcontainer/devcontainer.json', '.devcontainer.json'];

export interface DevcontainerBuild {
    /* Both from the project folder, with `/`. */
    dockerfile: string;
    context: string;
    args: Record<string, string>;
}

/* The part of a devcontainer.json a machine is started from, with every variable of the file filled in. */
export interface Devcontainer {
    name: string | null;
    image: string | null;
    build: DevcontainerBuild | null;
    workspaceFolder: string;
    /* As the engine's `--mount` takes it. */
    workspaceMount: string;
    mounts: string[];
    containerEnv: Record<string, string>;
    remoteUser: string | null;
    forwardPorts: number[];
    /* One line for a shell, or a program with its arguments. */
    postCreateCommand: string | string[] | null;
    /* Keys of the file that change nothing here, for the log. */
    ignored: string[];
}

export type DevcontainerRead = { ok: true; value: Devcontainer } | { ok: false; reason: string };

export interface DevcontainerPlace {
    /* The file's path from the project folder, with `/`. */
    file: string;
    /* The project folder on this computer. */
    folder: string;
}

const READ: readonly string[] = [
    'name',
    'image',
    'build',
    'workspaceFolder',
    'workspaceMount',
    'mounts',
    'containerEnv',
    'remoteUser',
    'forwardPorts',
    'postCreateCommand'
];
const READ_OF_BUILD: readonly string[] = ['dockerfile', 'context', 'args'];
// What decides what runs in the container: without these a start would bring up something other than the file says.
const NEEDED: readonly string[] = [
    'features',
    'dockerComposeFile',
    'initializeCommand',
    'onCreateCommand',
    'updateContentCommand',
    'postStartCommand',
    'postAttachCommand'
];
// A folder or file that holds a sign-in or Ruimte's own state on this computer, and the engine's socket.
const KEPT_OUT = /(^|\/)(\.ruimte(-dev)?|\.claude(\.json)?|\.codex|\.grok|\.gemini|docker\.sock)(\/|$)/;

class Unsupported extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
    return (
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0) ||
        (isRecord(value) && Object.keys(value).length === 0)
    );
}

function textOf(value: unknown, key: string): string | null {
    if (value === undefined) {
        return null;
    }

    if (typeof value !== 'string' || value.trim() === '') {
        throw new Unsupported(`"${key}" is not a text`);
    }

    return value;
}

function textsOf(value: unknown, key: string): Record<string, string> {
    if (value === undefined) {
        return {};
    }

    if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
        throw new Unsupported(`"${key}" is not a list of names with a text each`);
    }

    return value as Record<string, string>;
}

function variablesOf(value: unknown, key: string): Record<string, string> {
    const variables = textsOf(value, key);
    const wrong = Object.keys(variables).find((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name));

    if (wrong !== undefined) {
        throw new Unsupported(`"${key}" names ${JSON.stringify(wrong)}, which is no name of a variable`);
    }

    return variables;
}

/* A path of the file, which counts from the folder the file is in, as one from the project folder. */
export function fromProject(file: string, path: string): string {
    const parts: string[] = [];

    for (const part of [...file.split('/').slice(0, -1), ...path.split('/')]) {
        if (part === '..') {
            if (parts.length === 0) {
                throw new Unsupported(`"${path}" is outside the project folder`);
            }

            parts.pop();
        } else if (part !== '' && part !== '.') {
            parts.push(part);
        }
    }

    return parts.length === 0 ? '.' : parts.join('/');
}

function baseName(folder: string): string {
    return folder.split(/[\\/]/).findLast((part) => part !== '') ?? 'project';
}

function mountOf(entry: unknown, fill: (text: string) => string): string {
    const mount = isRecord(entry)
        ? ['type', 'source', 'target'].flatMap((key) => (typeof entry[key] === 'string' ? [`${key}=${entry[key]}`] : [])).join(',')
        : entry;

    if (typeof mount !== 'string' || mount === '') {
        throw new Unsupported('"mounts" holds a mount that is no text and has no type, source and target');
    }

    const filled = fill(mount);
    const source = /(?:^|,)(?:source|src)=([^,]*)/.exec(filled)?.[1] ?? '';

    if (KEPT_OUT.test(source.replaceAll('\\', '/'))) {
        throw new Unsupported(`"mounts" brings in ${source}, which Dev Containers keeps out of a container`);
    }

    return filled;
}

function portOf(entry: unknown): number {
    const port = typeof entry === 'string' && /^\d+$/.test(entry) ? Number(entry) : entry;

    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Unsupported(`"forwardPorts" holds ${JSON.stringify(entry)}, and only a port number is forwarded`);
    }

    return port;
}

function commandOf(value: unknown): string | string[] | null {
    if (value === undefined) {
        return null;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        return value;
    }

    if (Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string')) {
        return value as string[];
    }

    throw new Unsupported('"postCreateCommand" is neither one line nor a program with its arguments');
}

function buildOf(value: unknown, file: string): { build: DevcontainerBuild | null; ignored: string[] } {
    if (value === undefined) {
        return { build: null, ignored: [] };
    }

    if (!isRecord(value)) {
        throw new Unsupported('"build" is not a list of names');
    }

    if (!isEmpty(value.target)) {
        throw new Unsupported('it needs "build.target", which is not supported yet');
    }

    const dockerfile = textOf(value.dockerfile, 'build.dockerfile');
    const ignored = Object.keys(value)
        .filter((key) => !READ_OF_BUILD.includes(key) && key !== 'target')
        .map((key) => `build.${key}`);

    if (dockerfile === null) {
        return { build: null, ignored };
    }

    return {
        build: {
            dockerfile: fromProject(file, dockerfile),
            context: fromProject(file, textOf(value.context, 'build.context') ?? '.'),
            args: variablesOf(value.args, 'build.args')
        },
        ignored
    };
}

/*
 * Reads what a start needs from a devcontainer.json. A file that asks for something this cannot do answers the reason
 * instead: starting it anyway would bring up a container that is not the one the file describes.
 */
export function readDevcontainer(text: string, place: DevcontainerPlace): DevcontainerRead {
    try {
        return { ok: true, value: read(text, place) };
    } catch (e) {
        if (e instanceof Unsupported) {
            return { ok: false, reason: e.message };
        }

        return { ok: false, reason: 'it is no JSON' };
    }
}

function read(text: string, { file, folder }: DevcontainerPlace): Devcontainer {
    const json = parseJsonc(text);

    if (!isRecord(json)) {
        throw new Unsupported('it is no JSON');
    }

    const needed = NEEDED.filter((key) => !isEmpty(json[key]));

    if (needed.length > 0) {
        throw new Unsupported(`it needs ${needed.map((key) => `"${key}"`).join(', ')}, which ${needed.length === 1 ? 'is' : 'are'} not supported yet`);
    }

    const { build, ignored } = buildOf(json.build, file);
    const image = textOf(json.image, 'image');

    if (image === null && build === null) {
        throw new Unsupported('it names no "image" and no "build.dockerfile"');
    }

    const base = baseName(folder);
    const mount = textOf(json.workspaceMount, 'workspaceMount');
    const given = textOf(json.workspaceFolder, 'workspaceFolder');

    if (mount !== null && given === null) {
        throw new Unsupported('it has a "workspaceMount" and no "workspaceFolder"');
    }

    if (mount === null && folder.includes(',')) {
        throw new Unsupported('the project folder has a comma in its name, which the engine cannot mount');
    }

    const local: Record<string, string> = { localWorkspaceFolder: folder, localWorkspaceFolderBasename: base };
    // The folder first, with what is known of this computer alone, since every other text may name it.
    const workspaceFolder = given === null ? `/workspaces/${base}` : filled(given, local);
    const known = { ...local, containerWorkspaceFolder: workspaceFolder, containerWorkspaceFolderBasename: baseName(workspaceFolder) };
    const fill = (value: string): string => filled(value, known);
    const command = commandOf(json.postCreateCommand);

    if (json.mounts !== undefined && !Array.isArray(json.mounts)) {
        throw new Unsupported('"mounts" is not a list');
    }

    if (json.forwardPorts !== undefined && !Array.isArray(json.forwardPorts)) {
        throw new Unsupported('"forwardPorts" is not a list');
    }

    return {
        name: textOf(json.name, 'name'),
        image: build === null ? image : null,
        build,
        workspaceFolder,
        workspaceMount: mount === null ? `type=bind,source=${folder},target=/workspaces/${base}` : mountOf(mount, fill),
        mounts: ((json.mounts as unknown[] | undefined) ?? []).map((entry) => mountOf(entry, fill)),
        containerEnv: Object.fromEntries(Object.entries(variablesOf(json.containerEnv, 'containerEnv')).map(([key, value]) => [key, fill(value)])),
        remoteUser: textOf(json.remoteUser, 'remoteUser'),
        forwardPorts: [...new Set(((json.forwardPorts as unknown[] | undefined) ?? []).map(portOf))],
        postCreateCommand: typeof command === 'string' ? fill(command) : (command?.map(fill) ?? null),
        ignored: [...Object.keys(json).filter((key) => !READ.includes(key) && !NEEDED.includes(key) && !key.startsWith('$')), ...ignored].toSorted()
    };
}

/* A text of the file with its `${...}` variables filled in. One this does not know stops the read, since its text would reach the engine as it stands. */
function filled(text: string, known: Record<string, string>): string {
    return text.replace(/\$\{([^}]*)\}/g, (_whole, name: string) => {
        const value = known[name];

        if (value === undefined) {
            throw new Unsupported(`it uses \${${name}}, which is not supported yet`);
        }

        return value;
    });
}
