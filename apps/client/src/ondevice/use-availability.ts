import { useEffect, useState } from 'react';
import type { OnDeviceStatusResult } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import { transportFor } from '@/transport';
import { onDeviceClientFor } from './ondevice-client';

/* Whether the machine this window is about has the model, asked again whenever the settings open; null until it answered or while there is no link to a machine. */
export function useOnDeviceAvailability(): OnDeviceStatusResult | null {
    const endpointId = useEndpointId();
    const [answer, setAnswer] = useState<{ endpointId: string; status: OnDeviceStatusResult } | null>(null);

    useEffect(() => {
        const transport = transportFor(endpointId);
        if (transport === null) {
            return;
        }
        let alive = true;
        void onDeviceClientFor(transport)
            .refresh()
            .then((status) => alive && setAnswer({ endpointId, status }));
        return () => {
            alive = false;
        };
    }, [endpointId]);

    return answer?.endpointId === endpointId ? answer.status : null;
}
