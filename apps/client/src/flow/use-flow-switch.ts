import { useCallback, useEffect, useState } from 'react';
import type { FlowSwitch } from '@ruimte/contracts';
import { flowClient } from '@/project';
import { useProject } from '@/state/project';
import { useTransport } from '@/transport/context';

const OFF: FlowSwitch = { enabled: false };

export interface FlowSwitchHandle {
    state: FlowSwitch;
    /* Null until the daemon answered, so the button does not flash off and then on. */
    known: boolean;
    busy: boolean;
    enable(on: boolean): Promise<void>;
    error: string | null;
}

/*
 * Whether this flow runs on the machine the project comes from, and the one way to change that.
 * The recipe is saved first: the daemon writes down the fingerprint of what is on disk, so turning
 * a flow on with an unsaved change would turn it off again the moment the save landed.
 */
export const useFlowSwitch = (viewId: string): FlowSwitchHandle => {
    const transport = useTransport();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const [state, setState] = useState<FlowSwitch>(OFF);
    const [known, setKnown] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (projectId === null) {
            return;
        }
        let live = true;
        setKnown(false);
        void transport
            .request('flow.state', { projectId, viewId })
            .then((answer) => {
                if (live) {
                    setState(answer.switch);
                    setKnown(true);
                }
            })
            .catch(() => undefined);
        const off = transport.on('flow.switched', (event) => {
            if (event.projectId === projectId && event.viewId === viewId) {
                setState(event.switch);
                setKnown(true);
            }
        });
        return () => {
            live = false;
            off();
        };
    }, [transport, projectId, viewId]);

    const enable = useCallback(
        async (on: boolean): Promise<void> => {
            if (projectId === null) {
                return;
            }
            setBusy(true);
            setError(null);
            try {
                await flowClient.flush();
                const answer = await transport.request('flow.enable', { projectId, viewId, enabled: on });
                setState(answer.switch);
                setKnown(true);
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
            } finally {
                setBusy(false);
            }
        },
        [transport, projectId, viewId]
    );

    return { state, known, busy, enable, error };
};
