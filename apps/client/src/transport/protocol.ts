import { PROTOCOL_VERSION, protocolMismatch, type EndpointInfo, type ProtocolMismatch, type UsageClientKind } from '@ruimte/contracts';
import i18next from 'i18next';
import { usageClientKind } from './client-kind';

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
    /* `features` is what the machine answered; absent when it refused `endpoint.info`, which this check cannot judge. */
    open(features?: readonly string[]): void;
    message(data: string | Uint8Array): void;
    refuse(failure: string, mismatch: ProtocolMismatch): void;
}

/*
 * The check on a link before it opens: the wire version, and whether the machine names what it
 * answers (`features`). A machine without either is refused as older, since 0.18.0 is the oldest one
 * a client talks to. Frames that arrive before the answer (an event sent to every socket) are held
 * and delivered once the link is open.
 */
export function protocolGate(events: ProtocolGateEvents, client: number = PROTOCOL_VERSION, kind: UsageClientKind | null = usageClientKind()) {
    let checked = false;
    const held: Array<string | Uint8Array> = [];
    return {
        opened(): void {
            events.send(JSON.stringify({ id: CHECK_ID, type: 'endpoint.info', payload: kind === null ? {} : { client: kind } }));
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
            // A refused `endpoint.info` is a daemon this check cannot judge, and the transport has its own ways to fail.
            const mismatch =
                frame.ok !== true
                    ? null
                    : (protocolMismatch(frame.result?.protocol, client) ?? (Array.isArray(frame.result?.features) ? null : 'daemon-older'));
            if (mismatch !== null) {
                events.refuse(protocolRefusal(mismatch), mismatch);
                return;
            }
            events.open(frame.ok === true ? frame.result?.features : undefined);
            for (const entry of held.splice(0)) {
                events.message(entry);
            }
        }
    };
}

export function withProtocol(url: string, client: number = PROTOCOL_VERSION): string {
    return `${url}${url.includes('?') ? '&' : '?'}protocol=${client}`;
}
