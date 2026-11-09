interface NodeLifecycleEvents {
    /* A chat's turn ended, and how. */
    turnEnded: [chatId: string, state: 'done' | 'aborted' | 'error'];
    /* The process of a terminal is gone, whether it ended itself or was killed. */
    exited: [nodeId: string];
    /* A chat or terminal was ended by the daemon: stopped, killed, deleted or its project closed. */
    closed: [nodeId: string];
    /* The nodes a project still places, told before `placed`: what a node that is gone still runs ends here, while every store still knows it. */
    leaving: [projectId: string, ids: ReadonlySet<string>];
    /* The nodes a project still places, after the document changed; whatever belonged to another node of it is gone. */
    placed: [projectId: string, ids: ReadonlySet<string>];
}

type Listener<Event extends keyof NodeLifecycleEvents> = (...args: NodeLifecycleEvents[Event]) => void | Promise<void>;
type Told = Exclude<keyof NodeLifecycleEvents, 'leaving' | 'placed'>;

/*
 * What happens to a node, told once and heard by every store that keeps something per node. A store
 * subscribes where it is wired, so a node's end reaches it without a list that someone keeps by hand.
 */
export class NodeLifecycle {
    private readonly listeners = new Map<keyof NodeLifecycleEvents, Array<Listener<keyof NodeLifecycleEvents>>>();

    on<Event extends keyof NodeLifecycleEvents>(event: Event, listener: Listener<Event>): void {
        const heard = this.listeners.get(event) ?? [];
        heard.push(listener as Listener<keyof NodeLifecycleEvents>);
        this.listeners.set(event, heard);
    }

    /* Tells every listener in the order they subscribed. Resolves once those that work on after returning are done; one that throws stops the rest, as a call made in its place would have. */
    emit<Event extends Told>(event: Event, ...args: NodeLifecycleEvents[Event]): Promise<void> {
        return this.tell(event, ...args);
    }

    /*
     * The nodes a project still places. Every `leaving` listener runs before any `placed` one, so ending the
     * agents of a gone node reads its task and lineage before a prune takes them, whichever was wired first.
     */
    places(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        const leaving = this.tell('leaving', projectId, ids);
        const placed = this.tell('placed', projectId, ids);

        return Promise.all([leaving, placed]).then(() => undefined);
    }

    private tell<Event extends keyof NodeLifecycleEvents>(event: Event, ...args: NodeLifecycleEvents[Event]): Promise<void> {
        const pending: Array<void | Promise<void>> = [];
        for (const listener of [...(this.listeners.get(event) ?? [])]) {
            pending.push((listener as Listener<Event>)(...args));
        }
        return Promise.all(pending).then(() => undefined);
    }
}
