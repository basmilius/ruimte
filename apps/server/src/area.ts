import type { OutputGate } from './backpressure.ts';
import type { LiveSink } from './client-sinks.ts';
import type { Dispatcher } from './dispatcher.ts';
import type { ClientAccess, ClientConnection } from './wire.ts';

/* A part of the daemon that tells every client what changed in it. */
export interface EventSource {
    subscribe(clientId: string, sink: LiveSink): () => void;
}

/* A part that keeps what a client asked it to hold, like a watch or a stream, until the client goes. */
interface ClientHolder {
    detachAll(clientId: string): void;
}

/* What a connection hands an area that listens for more than events: the client, what it proved, and where its frames queue. */
export interface ClientEnd {
    client: ClientConnection;
    access: ClientAccess;
    sink: LiveSink;
    gate: OutputGate;
}

/*
 * When a step of the shutdown runs. `halt` is synchronous and first, before anything is awaited,
 * so a `bun --watch` reload that restarts the module during the first await loses nothing. `drain`
 * lets what is in flight finish, `end` closes what clients held, `last` leaves the machine's own
 * channels. Inside a phase the steps run in the order of the area list.
 */
export type StopPhase = 'halt' | 'drain' | 'end' | 'last';

interface StopStep {
    phase: StopPhase;
    /* Names the step in the log when it fails; a step that fails never keeps the next from running. */
    label: string;
    run(): void | Promise<void>;
}

/*
 * One wire area as the daemon knows it: the requests it answers, the event sources every client of
 * this machine hears, what it holds for a client and lets go of when the channel closes, and how it stops.
 * Every part is optional because an area is only the parts it has. A client that is another machine
 * (`access.peer`) is subscribed to no source and asks only what the area marked `peer`.
 */
export interface Area {
    readonly name: string;
    handlers?(dispatcher: Dispatcher): void;
    sources?: readonly EventSource[];
    holders?: readonly ClientHolder[];
    /* Anything a source cannot say: output the gate hears about, or presence. Returns what ends it. */
    connect?(end: ClientEnd): Array<() => void>;
    /* A channel opened, another machine's included; the counterpart of `closed`. */
    opened?(clientId: string, access: ClientAccess): void;
    /* The channel of a client closed; what it started here and nothing else keeps goes with it. */
    closed?(clientId: string, access: ClientAccess): void | Promise<void>;
    stop?: readonly StopStep[];
}

export function stopSteps(areas: readonly Area[], phase: StopPhase): StopStep[] {
    return areas.flatMap((area) => (area.stop ?? []).filter((step) => step.phase === phase));
}
