import { useCallback, useEffect, useState } from 'react';
import type { FlowArgValue, FlowArmedTest, FlowRun, FlowSwitch, FlowTestScope } from '@ruimte/contracts';
import { flowClient } from '@/project';
import { useProject } from '@/state/project';
import { useTransport } from '@/transport/context';

const OFF: FlowSwitch = { enabled: false };

export interface FlowTestRequest {
    from: string;
    scope: FlowTestScope;
    dry: boolean;
    tokens?: Record<string, FlowArgValue>;
}

export interface FlowStateHandle {
    state: FlowSwitch;
    /* Newest first, the way the daemon keeps them. */
    runs: FlowRun[];
    /* The test waiting for the next real firing, when a person armed one. */
    armed: FlowArmedTest | null;
    /* False until the daemon answered, so a button does not flash one way and then the other. */
    known: boolean;
    busy: boolean;
    error: string | null;
    enable(next: { enabled: boolean; watching?: boolean }): Promise<void>;
    /* Runs the flow now, for real, from a card a run can begin at. */
    start(cardId: string): Promise<FlowRun | null>;
    test(request: FlowTestRequest): Promise<FlowRun | null>;
    arm(test: FlowArmedTest | null): Promise<void>;
}

/*
 * What this flow is on this machine and what it has done. The recipe is saved before anything runs:
 * the daemon works from what is on disk, so trying out a worksheet with an unsaved change would try
 * out the one before it, and turning a flow on would turn itself off again the moment the save landed.
 */
export const useFlowState = (viewId: string): FlowStateHandle => {
    const transport = useTransport();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const [state, setState] = useState<FlowSwitch>(OFF);
    const [runs, setRuns] = useState<FlowRun[]>([]);
    const [armed, setArmed] = useState<FlowArmedTest | null>(null);
    const [known, setKnown] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (projectId === null || viewId === '') {
            return;
        }
        let live = true;
        setKnown(false);
        void transport
            .request('flow.state', { projectId, viewId })
            .then((answer) => {
                if (live) {
                    setState(answer.switch);
                    setRuns(answer.runs);
                    setArmed(answer.armed ?? null);
                    setKnown(true);
                }
            })
            .catch(() => undefined);
        const offSwitched = transport.on('flow.switched', (event) => {
            if (event.projectId === projectId && event.viewId === viewId) {
                setState(event.switch);
                setKnown(true);
            }
        });
        const offRun = transport.on('flow.run', (event) => {
            if (event.projectId !== projectId || event.viewId !== viewId) {
                return;
            }
            // A run is written over as it goes, so the one that came in replaces the line with its id.
            setRuns((before) => [event.run, ...before.filter((run) => run.id !== event.run.id)].sort((one, other) => other.startedAt - one.startedAt));
        });
        return () => {
            live = false;
            offSwitched();
            offRun();
        };
    }, [transport, projectId, viewId]);

    const ask = useCallback(
        async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
            if (projectId === null || viewId === '') {
                return fallback;
            }
            setBusy(true);
            setError(null);
            try {
                await flowClient.flush();
                return await work();
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                return fallback;
            } finally {
                setBusy(false);
            }
        },
        [projectId, viewId]
    );

    const enable = useCallback(
        async (next: { enabled: boolean; watching?: boolean }): Promise<void> => {
            await ask(async () => {
                const answer = await transport.request('flow.enable', { projectId: projectId as string, viewId, ...next });
                setState(answer.switch);
                setRuns(answer.runs);
                setKnown(true);
            }, undefined);
        },
        [ask, transport, projectId, viewId]
    );

    const start = useCallback(
        (cardId: string): Promise<FlowRun | null> =>
            ask(async () => {
                const answer = await transport.request('flow.start', { projectId: projectId as string, viewId, cardId });
                return answer.run;
            }, null),
        [ask, transport, projectId, viewId]
    );

    const test = useCallback(
        (request: FlowTestRequest): Promise<FlowRun | null> =>
            ask(async () => {
                const answer = await transport.request('flow.test', { projectId: projectId as string, viewId, ...request });
                return answer.run;
            }, null),
        [ask, transport, projectId, viewId]
    );

    const arm = useCallback(
        async (next: FlowArmedTest | null): Promise<void> => {
            await ask(async () => {
                const answer = await transport.request('flow.arm', { projectId: projectId as string, viewId, test: next });
                setState(answer.switch);
                setArmed(answer.armed ?? null);
            }, undefined);
        },
        [ask, transport, projectId, viewId]
    );

    return { state, runs, armed, known, busy, error, enable, start, test, arm };
};
