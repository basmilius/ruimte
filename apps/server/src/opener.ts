/*
 * Who opened a node, as the daemon keeps it in the lineage and in a hidden agent's record. Every kind but a node is
 * stored as a prefixed string, which older releases wrote the same way, so the stored form never changes.
 */
export type Opener =
    | { kind: 'node'; id: string }
    | { kind: 'routine'; id: string }
    | { kind: 'voice'; sessionId: string }
    | { kind: 'peer'; machineId: string; parentId: string }
    | { kind: 'extension'; id: string };

const ROUTINE_PREFIX = 'routine:';
const VOICE_PREFIX = 'voice:';
const PEER_PREFIX = 'peer:';
const EXTENSION_PREFIX = 'extension:';

/* A routine's run chats are opened by it, which keeps them in the project without a canvas. */
export function routineOpener(routineId: string): string {
    return `${ROUTINE_PREFIX}${routineId}`;
}

/* A Voice session, apart from every node id. */
export function voiceOpener(sessionId: string): string {
    return `${VOICE_PREFIX}${sessionId}`;
}

/* The node that gave a task, on the machine that did. */
export function peerOpener(machineId: string, parentId: string): string {
    return `${PEER_PREFIX}${machineId}:${parentId}`;
}

export function extensionOpener(extensionId: string): string {
    return `${EXTENSION_PREFIX}${extensionId}`;
}

/* Reads a stored opener; anything that is no other kind is a node. */
export function openerOf(stored: string): Opener {
    if (stored.startsWith(ROUTINE_PREFIX)) {
        return { kind: 'routine', id: stored.slice(ROUTINE_PREFIX.length) };
    }

    if (stored.startsWith(VOICE_PREFIX)) {
        return { kind: 'voice', sessionId: stored.slice(VOICE_PREFIX.length) };
    }

    if (stored.startsWith(EXTENSION_PREFIX)) {
        return { kind: 'extension', id: stored.slice(EXTENSION_PREFIX.length) };
    }

    if (stored.startsWith(PEER_PREFIX)) {
        const rest = stored.slice(PEER_PREFIX.length);
        const split = rest.indexOf(':');

        if (split > 0) {
            return { kind: 'peer', machineId: rest.slice(0, split), parentId: rest.slice(split + 1) };
        }
    }

    return { kind: 'node', id: stored };
}

export function storedOpener(opener: Opener): string {
    switch (opener.kind) {
        case 'node':
            return opener.id;
        case 'routine':
            return routineOpener(opener.id);
        case 'voice':
            return voiceOpener(opener.sessionId);
        case 'peer':
            return peerOpener(opener.machineId, opener.parentId);
        case 'extension':
            return extensionOpener(opener.id);
    }
}

/* Whether no project places the opener on a canvas: every kind but a node. */
export function isPlaceless(opener: Opener): boolean {
    return opener.kind !== 'node';
}
