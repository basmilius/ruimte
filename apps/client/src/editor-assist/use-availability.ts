import type { EditorAssistStatusResult } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { useEndpointId } from '@/state/keys';
import { useSettings } from '@/state/settings';
import { transportFor } from '@/transport';
import { editorAssistClientFor } from './client';

/* Whether the machine this window is about has the model, asked again whenever the settings open; null until it answered or while there is no link to a machine. */
export function useEditorAssistAvailability(): EditorAssistStatusResult | null {
    const endpointId = useEndpointId();
    const agent = useSettings((state) => state.aiAssistAgent);
    const key = JSON.stringify(agent);
    const [answer, setAnswer] = useState<{ endpointId: string; key: string; status: EditorAssistStatusResult } | null>(null);

    useEffect(() => {
        const transport = transportFor(endpointId);
        if (transport === null) {
            return;
        }
        let alive = true;
        void editorAssistClientFor(transport)
            .refresh()
            .then((status) => alive && setAnswer({ endpointId, key, status }));
        return () => {
            alive = false;
        };
    }, [endpointId, key]);

    return answer?.endpointId === endpointId && answer.key === key ? answer.status : null;
}
