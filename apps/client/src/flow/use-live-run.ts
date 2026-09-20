import { useEffect, useState } from 'react';
import type { FlowPort } from '@ruimte/contracts';
import { useProject } from '@/state/project';
import { useTransport } from '@/transport/context';

/*
 * How long the worksheet keeps showing the path a run took after it ended. A flow of four cards is
 * over in a blink, and the question a person is asking is which way it went, not whether it is still
 * going, so the answer stays up long enough to read.
 */
const LINGER_MS = 4000;

export interface FlowLiveRun {
    runId: string;
    /* The card the run began at, which is where the path through the graph is read from. */
    entry: string;
    settled: Record<string, FlowPort | null>;
    waiting: string[];
    /* The card that settled last, and the moment it did, so it can flash once and only once. */
    lastCard: string | null;
    lastAt: number;
    over: boolean;
}

/*
 * The run going on in this flow right now, as it happens. With twenty cards on a worksheet the
 * question is which path it took, and a graph that lights up answers that faster than a list does.
 * It is a stream of events and never a read: the timeline on disk is one write per run, and this is
 * what happens in between.
 */
export const useLiveRun = (viewId: string): FlowLiveRun | null => {
    const transport = useTransport();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const [live, setLive] = useState<FlowLiveRun | null>(null);

    useEffect(() => {
        if (projectId === null || viewId === '') {
            return;
        }
        let clear: number | undefined;
        const offRun = transport.on('flow.run', (event) => {
            if (event.projectId !== projectId || event.viewId !== viewId || event.run.trigger === undefined) {
                return;
            }
            const { run } = event;
            window.clearTimeout(clear);
            if (run.outcome === 'running') {
                setLive({
                    runId: run.id,
                    entry: run.trigger as string,
                    settled: run.settled ?? {},
                    waiting: run.waiting ?? [],
                    lastCard: null,
                    lastAt: run.startedAt,
                    over: false
                });
                return;
            }
            /* A run that never began leaves no path to show, so it does not take the last one down. */
            setLive((before) => (before === null || before.runId !== run.id ? before : { ...before, over: true }));
            clear = window.setTimeout(() => setLive((before) => (before?.runId === run.id ? null : before)), LINGER_MS);
        });
        const offStep = transport.on('flow.step', (event) => {
            if (event.projectId !== projectId || event.viewId !== viewId) {
                return;
            }
            setLive((before) =>
                before === null || before.runId !== event.runId
                    ? before
                    : { ...before, settled: event.settled, waiting: event.waiting, lastCard: event.step.cardId, lastAt: event.step.at }
            );
        });
        return () => {
            window.clearTimeout(clear);
            offRun();
            offStep();
        };
    }, [transport, projectId, viewId]);

    return live;
};
