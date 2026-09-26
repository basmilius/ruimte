import type { FramePort } from '@ruimte/agent-contracts';

/*
 * Two ends of a port in one process, for a test or a host and a client that live side by side. A
 * frame crosses as a copy and only once the sender's own code ran, the way a MessagePort delivers it,
 * so neither end ever holds the other's object.
 */
export const memoryPortPair = (): [FramePort, FramePort] => {
    const listeners: [Set<(frame: unknown) => void>, Set<(frame: unknown) => void>] = [new Set(), new Set()];
    const end = (own: number): FramePort => ({
        send: (frame) => {
            const copy = structuredClone(frame);
            queueMicrotask(() => {
                for (const listener of listeners[1 - own]!) {
                    listener(copy);
                }
            });
        },
        onFrame: (listener) => {
            listeners[own]!.add(listener);
            return () => {
                listeners[own]!.delete(listener);
            };
        }
    });
    return [end(0), end(1)];
};
