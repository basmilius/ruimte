import { PROTOCOL_VERSION, protocolMismatch, type EndpointInfo, type EndpointInfoPayload, type ProtocolMismatch } from '@ruimte/contracts';
import i18next from 'i18next';
import { clientIdentity } from './client-kind';

/* What a row and a failed connection say about a machine on another wire version. */
export function protocolRefusal(mismatch: ProtocolMismatch): string {
    return i18next.t(`machines:protocol.${mismatch}`);
}

// A request id the transport never hands out, since its own ids are numbers.
const CHECK_ID = 'protocol';

interface CheckFrame {
    id?: unknown;
    ok?: unknown;
    result?: Partial<EndpointInfo>;
}

function parseFrame(data: string): CheckFrame | null {
    try {
        const parsed: unknown = JSON.parse(data);
        return typeof parsed === 'object' && parsed !== null ? (parsed as CheckFrame) : null;
    } catch {
        return null;
    }
}

export interface ProtocolGateEvents {
    send(data: string): void;
    open(features: readonly string[]): void;
    message(data: string | Uint8Array): void;
    refuse(failure: string, mismatch: ProtocolMismatch): void;
}

/*
 * The check on a link before it opens: the wire version, and whether the machine names what it
 * answers (`features`). A machine without either is refused as older, since 0.18.0 is the oldest one
 * a client talks to. Frames that arrive before the answer (an event sent to every socket) are held
 * and delivered once the link is open.
 */
export function protocolGate(events: ProtocolGateEvents, client: number = PROTOCOL_VERSION, identity: EndpointInfoPayload = clientIdentity()) {
    let checked = false;
    const held: Array<string | Uint8Array> = [];
    return {
        opened(): void {
            events.send(JSON.stringify({ id: CHECK_ID, type: 'endpoint.info', payload: identity }));
        },
        received(data: string | Uint8Array): void {
            if (checked) {
                events.message(data);
                return;
            }
            const frame = typeof data === 'string' ? parseFrame(data) : null;
            if (frame === null || frame.id !== CHECK_ID) {
                held.push(data);
                return;
            }
            checked = true;
            // A machine that refuses `endpoint.info` names no version or features, so it is refused as older.
            const result = frame.ok === true ? frame.result : undefined;
            const features = result?.features;
            const mismatch = protocolMismatch(result?.protocol, client);
            if (mismatch !== null || !Array.isArray(features)) {
                const refusal = mismatch ?? 'daemon-older';
                events.refuse(protocolRefusal(refusal), refusal);
                return;
            }
            events.open(features);
            for (const entry of held.splice(0)) {
                events.message(entry);
            }
        }
    };
}

export function withProtocol(url: string, client: number = PROTOCOL_VERSION): string {
    return `${url}${url.includes('?') ? '&' : '?'}protocol=${client}`;
}
