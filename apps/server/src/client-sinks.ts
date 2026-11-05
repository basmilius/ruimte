import { ClientSinks as Sinks } from '@adecore/agents/host';
import type { LiveFrame } from '@ruimte/contracts';
import type { SessionEvent } from './wire.ts';

/* The clients listening to one part of the daemon, the `Subscribable` in `connection.ts` made real. */
export class ClientSinks extends Sinks<SessionEvent> {}

/* What a part with live streams sends: an event, or a frame for a client that asked for its pictures in binary. */
export type LiveEvent = SessionEvent | LiveFrame;
export type LiveSink = (event: LiveEvent) => void;

export class LiveSinks extends Sinks<LiveEvent> {}

export function isLiveFrame(event: LiveEvent): event is LiveFrame {
    return 'bytes' in event;
}
