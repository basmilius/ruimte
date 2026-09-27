import { BytesReadPayloadSchema, type BytesReadResult } from '@ruimte/contracts';
import { endpointById } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { BYTES_WORKER_SCRIPT } from './bytes-stream';

type PieceAnswer = { ok: true; result: BytesReadResult } | { ok: false; message: string };

let started = false;

/*
 * The page's half of a video over a direct connection: the worker asks for a piece of a file, and the
 * page asks the machine over the channel only it holds. Only a machine this page reaches directly is
 * asked, and only for a file, which the daemon serves only as an image or a video.
 */
const answer = (event: MessageEvent<unknown>): void => {
    const port = event.ports[0];
    if (!port || typeof event.data !== 'object' || event.data === null) {
        return;
    }
    const reply = (message: PieceAnswer): void => port.postMessage(message);
    const { machine, path, offset, length } = event.data as Record<string, unknown>;
    const payload = BytesReadPayloadSchema.safeParse({ resource: { kind: 'file', path }, offset, length });
    const transport = typeof machine === 'string' && endpointById(machine)?.direct === true ? transportFor(machine) : null;
    if (!payload.success || transport === null) {
        reply({ ok: false, message: 'Not a file on a machine this page reaches directly' });
        return;
    }
    transport.request('bytes.read', payload.data).then(
        (result) => reply({ ok: true, result }),
        (e: unknown) => reply({ ok: false, message: e instanceof Error ? e.message : String(e) })
    );
};

/*
 * Once, by the first workspace, so the start screen registers nothing. The listener is in place
 * before any video can ask, since a message nobody listens for is dropped.
 */
export const startBytesWorker = (): void => {
    if (started || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return;
    }
    started = true;
    navigator.serviceWorker.addEventListener('message', answer);
    navigator.serviceWorker.register(BYTES_WORKER_SCRIPT).catch((e: unknown) => console.warn('The bytes worker did not register', e));
};

/* Not before the worker controls the page, which it does not after a hard reload; a video plays from a blob then. */
export const bytesWorkerReady = (): boolean => started && navigator.serviceWorker.controller !== null;
