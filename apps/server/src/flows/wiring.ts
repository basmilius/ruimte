import { basename, dirname } from 'node:path';
import type { FlowEnablePayload, FlowNoticeEvent, FlowStateResult } from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import type { WatchSeams } from '../fs/watch-seam.ts';
import type { OutboxStore } from '../outbox/outbox.ts';
import type { OutboxHandlers } from '../outbox/outbox-worker.ts';
import type { OutboxLink } from '../outbox/wiring.ts';
import type { FlowStore } from '../projects/flow-store.ts';
import { PROJECT_DIR } from '../projects/project-files.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { SessionSink } from '../sessions/manager.ts';
import { FlowArmStore } from './arm-store.ts';
import { flowCardHandlers } from './cards.ts';
import { FlowFileWatcher } from './file-trigger.ts';
import { FlowRunner } from './runner.ts';
import { FlowSwitchStore } from './switch-store.ts';
import { FlowTimeline } from './timeline.ts';

export interface FlowWiringDeps {
    home: string;
    projects: ProjectStore;
    flows: FlowStore;
    outbox: OutboxStore;
    link: OutboxLink;
    /* Opens a turn in a chat, which is what the send a message card does; false when it is gone. */
    message(chatId: string, text: string, label: string): Promise<boolean>;
    now?: () => number;
    mintId?: () => string;
    seams?: WatchSeams;
}

export interface FlowWiring {
    switches: FlowSwitchStore;
    armed: FlowArmStore;
    timeline: FlowTimeline;
    runner: FlowRunner;
    watcher: FlowFileWatcher;
    /* Everything a client hears about flows, over one channel. */
    subscribe(clientId: string, sink: SessionSink): () => void;
    handlers: Pick<OutboxHandlers, 'run-flow' | 'flow-trigger'>;
    /* Looks at one flow again after anything that could have changed what it listens for. */
    rearm(projectId: string, viewId: string): Promise<void>;
    /* A person turns a flow on or off, which is the one way that happens. */
    enable(payload: FlowEnablePayload, by: string): Promise<FlowStateResult>;
    /* Reads the switches and takes up what this machine was left with. */
    start(): Promise<void>;
    stop(): void;
}

/*
 * Everything a flow needs to run, wired once so the daemon and a test daemon hold the same thing.
 * The runner is built before the outbox worker because it hands it two handlers; it reaches the
 * worker back through the link, the same way the chat manager does.
 */
export const wireFlows = (deps: FlowWiringDeps): FlowWiring => {
    const sinks = new ClientSinks();
    const now = deps.now ?? Date.now;
    const switches = new FlowSwitchStore(deps.home, (event) => sinks.emit(event));
    const armed = new FlowArmStore(deps.home);
    const timeline = new FlowTimeline(deps.home, { now, emit: (event) => sinks.emit(event) });
    const notify = (event: FlowNoticeEvent): void => sinks.emit({ event: 'flow.notice', payload: event });
    // The runner reaches the watcher and the watcher reaches the runner, so neither type is inferred.
    const runner: FlowRunner = new FlowRunner({
        read: (projectId, viewId) => deps.flows.read(projectId, viewId),
        nameOf: async (projectId, viewId) => {
            const place = await deps.projects.place(projectId).catch(() => null);
            return place?.views.find((view) => view.id === viewId)?.name ?? 'a flow';
        },
        switches,
        armed,
        timeline,
        outbox: deps.outbox,
        enqueue: (projectId, target, work, notBefore) => deps.link.enqueue(projectId, target, work, notBefore),
        handlers: flowCardHandlers({ notify, message: deps.message, now }),
        notify,
        step: (event) => sinks.emit({ event: 'flow.step', payload: event }),
        listens: (): Promise<void> => watcher.refresh(),
        now,
        ...(deps.mintId ? { mintId: deps.mintId } : {})
    });
    const watcher: FlowFileWatcher = new FlowFileWatcher({
        runner,
        folderOf: async (projectId) => {
            const place = await deps.projects.place(projectId).catch(() => null);
            return place === null ? null : folderOfDocument(place.documentPath);
        },
        ...(deps.seams ? { seams: deps.seams } : {})
    });

    const rearm = async (projectId: string, viewId: string): Promise<void> => {
        await runner.arm(projectId, viewId);
        await watcher.refresh();
    };

    /*
     * A recipe that changed under the daemon (a pull, another machine, an agent with a shell) is a
     * different flow than the one that was turned on, so its moments are worked out again and the
     * fingerprint decides whether it may still run at all.
     */
    deps.flows.subscribe('the flow runner', (event) => {
        if (event.event !== 'flow.changed') {
            return;
        }
        const { projectId, viewId } = event.payload;
        void rearm(projectId, viewId).catch((e: unknown) => {
            console.error(`Looking at flow ${viewId} again failed:`, e instanceof Error ? e.message : e);
        });
    });

    return {
        switches,
        armed,
        timeline,
        runner,
        watcher,
        rearm,
        subscribe: (clientId, sink) => sinks.subscribe(clientId, sink),
        async enable(payload, by) {
            const state = await runner.enable(payload, by);
            await watcher.refresh();
            return state;
        },
        handlers: {
            'run-flow': (entry) => runner.step(entry),
            'flow-trigger': (entry) => runner.moment(entry)
        },
        async start() {
            await switches.load();
            await armed.load();
            await runner.armAll();
            await watcher.refresh();
        },
        stop() {
            watcher.stop();
        }
    };
};

/* `<folder>/.ruimte/project.json` back to `<folder>`; a project that lives under the app data has none. */
const folderOfDocument = (documentPath: string): string | null => {
    const dir = dirname(documentPath);
    return basename(dir) === PROJECT_DIR ? dirname(dir) : null;
};
