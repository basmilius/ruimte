import { PROTOCOL_VERSION, protocolMismatch, type EndpointInfo, type ProtocolMismatch } from '@ruimte/contracts';

const REFUSALS: Record<ProtocolMismatch, string> = {
    'daemon-older': 'This machine runs an older Ruimte. Update Ruimte there, or restart it to pick up the update.',
    'daemon-newer': 'This machine runs a newer Ruimte than this app. Update this app.'
};

/* What a row and a failed connection say about a machine on another wire version. */
export const protocolRefusal = (mismatch: ProtocolMismatch): string => REFUSALS[mismatch];

// A request id the transport never hands out: its own ids are numbers.
const CHECK_ID = 'protocol';

interface CheckFrame {
    id?: unknown;
    ok?: unknown;
    result?: Partial<EndpointInfo>;
}

const parseFrame = (data: string): CheckFrame | null => {
    try {
        const parsed: unknown = JSON.parse(data);
        return typeof parsed === 'object' && parsed !== null ? (parsed as CheckFrame) : null;
    } catch {
        return null;
    }
};

export interface ProtocolGateEvents {
    send(data: string): void;
    open(): void;
    message(data: string): void;
    refuse(failure: string): void;
}

/*
 * The version check on a socket. The daemon closes a socket that offered another version, but a
 * daemon from before versions takes every socket, so the client asks `endpoint.info` before it calls
 * the link open and refuses an answer without a version. Frames that arrive before the answer (an
 * event sent to every socket) are held and delivered once the link is open.
 */
export const protocolGate = (events: ProtocolGateEvents, client: number = PROTOCOL_VERSION) => {
    let checked = false;
    const held: string[] = [];
    return {
        opened(): void {
            events.send(JSON.stringify({ id: CHECK_ID, type: 'endpoint.info', payload: {} }));
        },
        received(data: string): void {
            if (checked) {
                events.message(data);
                return;
            }
            const frame = parseFrame(data);
            if (frame === null || frame.id !== CHECK_ID) {
                held.push(data);
                return;
            }
            checked = true;
            // A refused `endpoint.info` is a daemon this check cannot judge, and the transport has its own ways to fail.
            const mismatch = frame.ok === true ? protocolMismatch(frame.result?.protocol, client) : null;
            if (mismatch !== null) {
                events.refuse(protocolRefusal(mismatch));
                return;
            }
            events.open();
            for (const entry of held.splice(0)) {
                events.message(entry);
            }
        }
    };
};

/* The socket URL with this client's version on it. */
export const withProtocol = (url: string, client: number = PROTOCOL_VERSION): string => `${url}${url.includes('?') ? '&' : '?'}protocol=${client}`;
