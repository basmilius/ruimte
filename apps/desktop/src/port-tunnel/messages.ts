import { PORT_TUNNEL_MESSAGE_BYTES, type PortTunnelRequest, type PortTunnelToShell } from '@ruimte/desktop-bridge';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStream(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
}

/* Reads what the page asked to open: three plain fields and nothing else survives. */
export function parseTunnelRequest(value: unknown): PortTunnelRequest | null {
    if (!isRecord(value)) {
        return null;
    }

    const { endpointId, grantId, port } = value;

    if (
        typeof endpointId !== 'string' ||
        endpointId === '' ||
        endpointId.length > 1024 ||
        typeof grantId !== 'string' ||
        grantId === '' ||
        grantId.length > 64
    ) {
        return null;
    }

    return Number.isInteger(port) && (port as number) >= 1 && (port as number) <= 65535 ? { endpointId, grantId, port: port as number } : null;
}

/* Reads a message from the page; a message that is not exactly one of the four is dropped. */
export function parseToShell(value: unknown): PortTunnelToShell | null {
    if (!isRecord(value) || typeof value.id !== 'string' || !isStream(value.stream)) {
        return null;
    }

    const { id, stream } = value;

    switch (value.kind) {
        case 'opened':
            return value.error === null || typeof value.error === 'string'
                ? { kind: 'opened', id, stream, error: value.error === null ? null : value.error.slice(0, 300) }
                : null;
        case 'data':
            return value.data instanceof Uint8Array && value.data.byteLength > 0 && value.data.byteLength <= PORT_TUNNEL_MESSAGE_BYTES
                ? { kind: 'data', id, stream, data: value.data }
                : null;
        case 'flushed':
            return Number.isSafeInteger(value.bytes) && (value.bytes as number) >= 0 ? { kind: 'flushed', id, stream, bytes: value.bytes as number } : null;
        case 'end':
            return value.reason === null || typeof value.reason === 'string'
                ? { kind: 'end', id, stream, reason: value.reason === null ? null : value.reason.slice(0, 300) }
                : null;
        default:
            return null;
    }
}
