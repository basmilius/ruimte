import { BytesReadPayloadSchema } from '@ruimte/contracts';
import { endpointById } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { BYTES_WORKER_SCRIPT } from './bytes-stream';
import { readPiece, type BytesPiece } from './piece';

type PieceAnswer = { ok: true; result: BytesPiece } | { ok: false; message: string };

let started = false;

/*
 * The page's half of a video over a direct connection: the worker asks for a piece of a file, and the
 * page asks the machine over the channel only it holds. Only a machine this page reaches directly is
 * asked, and only for a file, which the daemon serves only as an image, a video or sound.
 */
function answer(event: MessageEvent<unknown>): void {
    const port = event.ports[0];
    if (!port || typeof event.data !== 'object' || event.data === null) {
        return;
    }
    // A piece's buffer is handed over rather than copied, since the page reads nothing of it afterwards.
    const reply = (message: PieceAnswer): void => port.postMessage(message, message.ok ? [message.result.bytes.buffer] : []);
    const { machine, path, offset, length } = event.data as Record<string, unknown>;
    const payload = BytesReadPayloadSchema.safeParse({ resource: { kind: 'file', path }, offset, length });
    const transport = typeof machine === 'string' && endpointById(machine)?.direct === true ? transportFor(machine) : null;
    if (!payload.success || transport === null) {
        reply({ ok: false, message: 'Not a file on a machine this page reaches directly' });
        return;
    }
    readPiece(transport, payload.data).then(
        (result) => reply({ ok: true, result }),
        (e: unknown) => reply({ ok: false, message: e instanceof Error ? e.message : String(e) })
    );
}

/*
 * Once, by the first workspace, so the start screen registers nothing. The listener is in place
 * before any video can ask, since a message nobody listens for is dropped.
 */
export function startBytesWorker(): void {
    if (started || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return;
    }
    started = true;
    navigator.serviceWorker.addEventListener('message', answer);
    navigator.serviceWorker.register(BYTES_WORKER_SCRIPT).catch((e: unknown) => console.warn('The bytes worker did not register', e));
}

/* Not before the worker controls the page, which it does not after a hard reload; a video plays from a blob then. */
export function bytesWorkerReady(): boolean {
    return started && navigator.serviceWorker.controller !== null;
}
