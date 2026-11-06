import type { ActionRegistry } from '@ruimte/actions';
import { provideClientActions } from '@/action-port/perform';
import { createClientActionRegistry } from '@/actions/client-actions';
import { watchPrWatches } from '@/github/pr-watches';
import { provideExtensionChat } from '@/nodes/extension-chat';
import { useDocument } from '@/state/document';
import { PlanSync } from '@/state/plans';
import { watchPushAttention } from '@/state/push-attention';
import { watchSnoozes } from '@/state/snooze';
import { textDrafts } from '@/state/text-drafts';
import { machineAnswers } from '@/transport/features';
import { pool } from '@/transport/index';
import { reportPresence } from '@/transport/presence';
import { watchEveryMachine } from '@/workspace/connections';
import { liveDraftLink } from '@/workspace/draft-link';

/* What the lower layers are handed once, so none of them imports the feature that fills it. */
export interface ClientHooks {
    /* The registry `perform` runs; asking it before the hooks are installed throws. */
    readonly actions: ActionRegistry<void>;
}

let installed: ClientHooks | null = null;

/*
 * Installs the late hooks: the action registry, the chat body of an extension, the live link of a text
 * draft and what every machine's link is watched for. Once per process, whoever calls it first: `main.tsx`,
 * the DOM harness and the unit preload all take this same wiring.
 */
export function installClientHooks(): ClientHooks {
    if (installed !== null) {
        return installed;
    }
    const actions = createClientActionRegistry(useDocument);
    provideClientActions(actions);
    provideExtensionChat();
    textDrafts.provideLinks(liveDraftLink);
    watchEveryMachine((endpointId, transport) => watchPushAttention(endpointId, transport));
    watchEveryMachine((endpointId, transport) => reportPresence(transport, () => machineAnswers(pool.statusOf(endpointId), 'presence.report')));
    watchEveryMachine((endpointId, transport) => watchSnoozes(endpointId, transport));
    watchEveryMachine((endpointId, transport) => watchPrWatches(endpointId, transport));
    watchEveryMachine((endpointId, transport) => {
        const plans = new PlanSync(endpointId, transport);

        return () => plans.dispose();
    });
    installed = { actions };

    return installed;
}
