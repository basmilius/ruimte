import type { ArtifactGetResult } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { holdArtifacts, useArtifactRevision } from '@/output/artifacts';
import { machineTransport } from '@/transport';
import { useEndpointConnection } from '@/transport/status';
import { isConnectionError } from '@/transport/transport';

type ArtifactState =
    | { status: 'loading' }
    | { status: 'ready'; result: ArtifactGetResult }
    // The machine no longer has it: a person removed it, or a cleanup took every version.
    | { status: 'gone' }
    | { status: 'unreachable' };

/* One artifact with every version, read again whenever the machine says it changed. */
export function useArtifact(endpointId: string, artifactId: string, answers: boolean): ArtifactState {
    const revision = useArtifactRevision(endpointId, artifactId);
    const [held, setHeld] = useState<{ key: string; state: ArtifactState } | null>(null);
    const open = useEndpointConnection(endpointId).status === 'open';
    const key = `${endpointId}\n${artifactId}`;

    useEffect(() => (answers ? holdArtifacts(endpointId, null) : undefined), [endpointId, answers]);

    useEffect(() => {
        if (!answers || !open) {
            return;
        }
        let live = true;
        machineTransport(endpointId)
            .request('artifact.get', { artifactId })
            .then((result) => {
                if (live) {
                    setHeld({ key, state: { status: 'ready', result } });
                }
            })
            .catch((error: unknown) => {
                if (live) {
                    setHeld((current) =>
                        // What was on screen stays while the link is down, so a reconnect does not blank the view.
                        isConnectionError(error) && current?.key === key && current.state.status === 'ready'
                            ? current
                            : { key, state: isConnectionError(error) ? { status: 'unreachable' } : { status: 'gone' } }
                    );
                }
            });
        return () => {
            live = false;
        };
    }, [endpointId, artifactId, key, revision, answers, open]);

    if (held !== null && held.key === key) {
        return held.state;
    }
    return open ? LOADING : UNREACHABLE;
}

const LOADING: ArtifactState = { status: 'loading' };
const UNREACHABLE: ArtifactState = { status: 'unreachable' };
