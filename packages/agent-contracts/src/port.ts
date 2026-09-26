import type { Request, ServerFrame } from './envelope.ts';

/*
 * Two ends that pass the wire's frames without a socket: a MessagePort between a renderer and the
 * process that runs the chats, or a pair in a test. A frame is checked where it arrives, so it
 * crosses as `unknown`.
 */
export interface FramePort {
    send(frame: Request | ServerFrame): void;
    onFrame(listener: (frame: unknown) => void): () => void;
}
