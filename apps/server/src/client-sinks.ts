import { ClientSinks as Sinks } from '@adecore/agents/client-sinks';
import type { SessionEvent } from './sessions/manager.ts';

/* The clients listening to one part of the daemon, the `Subscribable` in `connection.ts` made real. */
export class ClientSinks extends Sinks<SessionEvent> {}
