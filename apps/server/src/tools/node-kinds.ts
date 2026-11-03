import { DEFAULT_TITLES } from '@ruimte/contracts';

export const NODE_VERB_KINDS = ['note', 'browser', 'drawing', 'diagram', 'file', 'device', 'terminal', 'chat', 'artifact', 'routine'] as const;
type NodeVerbKind = (typeof NODE_VERB_KINDS)[number];

type FlaggedKind = 'artifact' | 'routine';

// What --json takes: an artifact or a routine node names what it shows with flags of its own, which the batch does not carry.
export const JSON_NODE_KINDS = NODE_VERB_KINDS.filter((kind): kind is Exclude<NodeVerbKind, FlaggedKind> => kind !== 'artifact' && kind !== 'routine');

export type KindFlag = 'text' | 'url' | 'path' | 'source' | 'device' | 'cwd' | 'artifact' | 'version' | 'routine';

// The flags that only mean something on one kind; every kind takes --title, --view and --beside.
export const KIND_FLAGS: Record<NodeVerbKind, readonly KindFlag[]> = {
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

export const REQUIRED_FLAG: Partial<Record<NodeVerbKind, KindFlag>> = {
    browser: 'url',
    drawing: 'source',
    diagram: 'source',
    file: 'path',
    device: 'device',
    artifact: 'artifact',
    routine: 'routine'
};

/* Which kinds a flag goes with, from the same table `run` refuses against, so help cannot claim another pairing. */
export function kindsFor(flag: KindFlag): string {
    return NODE_VERB_KINDS.filter((kind) => KIND_FLAGS[kind].includes(flag))
        .map((kind) => (REQUIRED_FLAG[kind] === flag ? `${kind} (required)` : kind))
        .join(', ');
}

/* What the title falls back to without `--title`, in the order `run` picks it. */
function untitled(kind: NodeVerbKind): string {
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

/* The line about one kind, in help and in a refusal about that kind, so both name the same flags. */
export function kindLine(kind: NodeVerbKind): string {
    return `kind\t${kind}\t${KIND_FLAGS[kind].map((flag) => `--${flag}${REQUIRED_FLAG[kind] === flag ? ' (required)' : ''}`).join(', ')}\tcalled ${untitled(kind)} without --title`;
}

/* The three flags no kind is without; a refusal about one kind would otherwise read as if they were gone. */
export const EVERY_KIND_LINE = 'kind\tevery kind\t--title T, --view V, --beside N';
