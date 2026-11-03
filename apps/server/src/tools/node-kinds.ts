import { DEFAULT_TITLES } from '@ruimte/contracts';

export const NODE_NEW_KINDS = ['note', 'browser', 'drawing', 'diagram', 'file', 'device', 'terminal', 'chat', 'artifact', 'routine'] as const;
type NodeNewKind = (typeof NODE_NEW_KINDS)[number];

type OwnFieldKind = 'artifact' | 'routine';

// What json takes: an artifact or a routine node names what it shows with fields of its own, which the batch does not carry.
export const JSON_NODE_KINDS = NODE_NEW_KINDS.filter((kind): kind is Exclude<NodeNewKind, OwnFieldKind> => kind !== 'artifact' && kind !== 'routine');

export type KindField = 'text' | 'url' | 'path' | 'source' | 'device' | 'cwd' | 'artifact' | 'version' | 'routine';

// The fields that only mean something on one kind; every kind takes title, view and beside.
export const KIND_FIELDS: Record<NodeNewKind, readonly KindField[]> = {
    note: ['text'],
    browser: ['url'],
    drawing: ['source'],
    diagram: ['source'],
    file: ['path'],
    device: ['device'],
    terminal: ['cwd'],
    chat: ['cwd'],
    artifact: ['artifact', 'version'],
    routine: ['routine']
};

export const REQUIRED_FIELD: Partial<Record<NodeNewKind, KindField>> = {
    browser: 'url',
    drawing: 'source',
    diagram: 'source',
    file: 'path',
    device: 'device',
    artifact: 'artifact',
    routine: 'routine'
};

/* Which kinds a field goes with, from the same table `run` refuses against, so a guide cannot claim another pairing. */
export function kindsFor(field: KindField): string {
    return NODE_NEW_KINDS.filter((kind) => KIND_FIELDS[kind].includes(field))
        .map((kind) => (REQUIRED_FIELD[kind] === field ? `${kind} (required)` : kind))
        .join(', ');
}

/* What the title falls back to without `title`, in the order `run` picks it. */
function untitled(kind: NodeNewKind): string {
    if (kind === 'drawing' || kind === 'diagram') {
        return `the name of the ${kind} view`;
    }
    if (kind === 'file') {
        return "the file's own name";
    }
    if (kind === 'device') {
        return "the device's own name";
    }
    if (kind === 'artifact') {
        return "the artifact's own title";
    }
    if (kind === 'routine') {
        return "the routine's own title";
    }
    return `"${DEFAULT_TITLES[kind]}"`;
}

/* The three fields no kind is without; a refusal about one kind would otherwise read as if they were gone. */
export const EVERY_KIND_LINE = 'kind\tevery kind\ttitle, view, beside';

/* The fields of one kind, as `guide` and a refusal about that kind print them, so both name the same fields. */
export function kindLine(kind: NodeNewKind): string {
    return `kind\t${kind}\t${KIND_FIELDS[kind].map((flag) => `${flag}${REQUIRED_FIELD[kind] === flag ? ' (required)' : ''}`).join(', ')}\tcalled ${untitled(kind)} without title`;
}
