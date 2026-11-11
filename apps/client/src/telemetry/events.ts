import type { DedupeStore } from '@ruimte/telemetry';

export type MachineKind = 'local' | 'remote';

export type LinkKind = 'socket' | 'direct';

/* What a link to a machine went through, as the transport sees it. Never a payload, an address or a machine's name. */
export type LinkProblem =
    | { kind: 'dropped'; code: number | null }
    | { kind: 'timeout'; request: string }
    | { kind: 'refused'; mismatch: string }
    | { kind: 'unread'; frame: UnreadFrame }
    | ({ kind: 'degraded' } & Degraded);

/* A frame the client threw away. Only an event's or a request's type goes along, never what it carried. */
export type UnreadFrame = { kind: 'not-json' } | { kind: 'malformed' } | { kind: 'invalid-event'; event: string } | { kind: 'bad-reply'; request: string };

/* A reply or an event of a newer machine, read with what this version could not: how much of each, never what. */
export interface Degraded {
    frame: { request: string } | { event: string };
    members: number;
    dropped: number;
    words: number;
}

export type ConnectionProblem = LinkProblem & { machine: MachineKind; link: LinkKind };

interface ConnectionEvent {
    message: string;
    level: 'error' | 'info';
    fingerprint: string[];
    tags: Record<string, string>;
}

/* The tags a report of the client may carry; the scrubber drops every other one. */
export const CLIENT_TAGS: readonly string[] = [
    'surface',
    'process',
    'platform',
    'problem',
    'machine',
    'link',
    'close_code',
    'request',
    'mismatch',
    'event',
    'members',
    'dropped',
    'words'
];

export function connectionEvent(problem: ConnectionProblem): ConnectionEvent {
    const where = { machine: problem.machine, link: problem.link };
    switch (problem.kind) {
        case 'dropped': {
            const code = problem.code === null ? 'none' : String(problem.code);
            return {
                message: `The ${problem.link} link to a ${problem.machine} machine dropped (${code})`,
                level: 'error',
                fingerprint: ['connection-dropped', problem.machine, problem.link, code],
                tags: { problem: 'connection-dropped', ...where, close_code: code }
            };
        }
        // A machine that stops answering leaves every pending request without one, so they group by the link and not the request.
        case 'timeout':
            return {
                message: `A request to a ${problem.machine} machine got no answer in time`,
                level: 'error',
                fingerprint: ['request-timeout', problem.machine, problem.link],
                tags: { problem: 'request-timeout', ...where, request: problem.request }
            };
        // The check doing its work: an update that has not reached one of the two ends yet.
        case 'refused':
            return {
                message: `A machine was refused at the protocol check (${problem.mismatch})`,
                level: 'info',
                fingerprint: ['protocol-refused', problem.mismatch],
                tags: { problem: 'protocol-refused', ...where, mismatch: problem.mismatch }
            };
        // Most often a client and a machine on different versions; the release tag says the client's.
        case 'unread':
            return unreadEvent(problem.frame, where);
        // A machine newer than this client, which keeps working: a sign of how far behind clients run, not a fault.
        case 'degraded': {
            const type = 'request' in problem.frame ? problem.frame.request : problem.frame.event;
            return {
                message: `Read a ${type} ${'request' in problem.frame ? 'reply' : 'event'} of a newer ${problem.machine} machine in part`,
                level: 'info',
                fingerprint: ['newer-machine', type],
                tags: {
                    problem: 'newer-machine',
                    ...where,
                    ...problem.frame,
                    members: String(problem.members),
                    dropped: String(problem.dropped),
                    words: String(problem.words)
                }
            };
        }
    }
}

function unreadEvent(frame: UnreadFrame, where: { machine: MachineKind; link: LinkKind }): ConnectionEvent {
    if (frame.kind === 'invalid-event') {
        return {
            message: `Dropped a ${frame.event} event from a ${where.machine} machine that failed validation`,
            level: 'error',
            fingerprint: ['invalid-event', frame.event],
            tags: { problem: 'invalid-event', ...where, event: frame.event }
        };
    }

    if (frame.kind === 'bad-reply') {
        return {
            message: `Refused a ${frame.request} reply from a ${where.machine} machine that failed validation`,
            level: 'error',
            fingerprint: ['bad-reply', frame.request],
            tags: { problem: 'bad-reply', ...where, request: frame.request }
        };
    }

    const problem = frame.kind === 'not-json' ? 'frame-not-json' : 'frame-malformed';

    return {
        message: `Dropped a ${frame.kind === 'not-json' ? 'non-JSON' : 'malformed'} frame from a ${where.machine} machine`,
        level: 'error',
        fingerprint: [problem],
        tags: { problem, ...where }
    };
}

const SENT_KEY = 'ruimte.telemetry.sent';

/* Every window of the app shares it, so one error goes out once a day for the whole app, not once per window. */
export function storageDedupeStore(storage: () => Pick<Storage, 'getItem' | 'setItem'>): DedupeStore {
    return {
        read: () => {
            const parsed: unknown = JSON.parse(storage().getItem(SENT_KEY) ?? '{}');
            return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
        },
        write: (entries) => storage().setItem(SENT_KEY, JSON.stringify(entries))
    };
}
