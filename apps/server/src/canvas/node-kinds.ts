import { DEFAULT_TITLES } from '@ruimte/contracts';

export const NODE_VERB_KINDS = ['note', 'browser', 'drawing', 'diagram', 'file', 'terminal', 'chat'] as const;
export type NodeVerbKind = (typeof NODE_VERB_KINDS)[number];

export type KindFlag = 'text' | 'url' | 'path' | 'source' | 'cwd';

// The flags that only mean something on one kind; every kind takes --title, --view and --beside.
export const KIND_FLAGS: Record<NodeVerbKind, readonly KindFlag[]> = {
    note: ['text'],
    browser: ['url'],
    drawing: ['source'],
    diagram: ['source'],
    file: ['path'],
    terminal: ['cwd'],
    chat: ['cwd']
};

export const REQUIRED_FLAG: Partial<Record<NodeVerbKind, KindFlag>> = { browser: 'url', drawing: 'source', diagram: 'source', file: 'path' };

/* Which kinds a flag goes with, from the same table `run` refuses against, so help cannot claim another pairing. */
export const kindsFor = (flag: KindFlag): string =>
    NODE_VERB_KINDS.filter((kind) => KIND_FLAGS[kind].includes(flag))
        .map((kind) => (REQUIRED_FLAG[kind] === flag ? `${kind} (required)` : kind))
        .join(', ');

/* What the title falls back to without `--title`, in the order `run` picks it. */
const untitled = (kind: NodeVerbKind): string => {
    if (kind === 'drawing' || kind === 'diagram') {
        return `the name of the ${kind} view`;
    }
    if (kind === 'file') {
        return "the file's own name";
    }
    return `"${DEFAULT_TITLES[kind]}"`;
};

/* The line about one kind, in help and in a refusal about that kind, so both name the same flags. */
export const kindLine = (kind: NodeVerbKind): string =>
    `kind\t${kind}\t${KIND_FLAGS[kind].map((flag) => `--${flag}${REQUIRED_FLAG[kind] === flag ? ' (required)' : ''}`).join(', ')}\tcalled ${untitled(kind)} without --title`;

/* The three flags no kind is without; a refusal about one kind would otherwise read as if they were gone. */
export const EVERY_KIND_LINE = 'kind\tevery kind\t--title T, --view V, --beside N';
