import type { ServerFrame } from '@ruimte/contracts';
import type { Dispatcher } from '../dispatcher.ts';
import type { ClientAccess } from '../wire.ts';

/** Sends one request as `client` and returns the first frame the dispatcher answers with. */
export async function askOnce(dispatcher: Dispatcher, client: { id: string; access?: ClientAccess }, type: string, payload: unknown): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ ...client, send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
}
