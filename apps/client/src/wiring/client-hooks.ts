import type { ActionRegistry } from '@ruimte/actions';
import { provideClientActionLoader } from '@/action-port/client-action-loader';
import { watchPrWatches } from '@/github/pr-watches';
import { provideExtensionChat } from '@/nodes/extension-chat';
import { PlanSync } from '@/plan/plans';
import { useDocument } from '@/state/document';
import { watchNodeActivity } from '@/state/node-activity';
import { watchPushAttention } from '@/state/push-attention';
import { watchSnoozes } from '@/state/snooze';
import { textDrafts } from '@/state/text-drafts';
import { machineAnswers } from '@/transport/features';
import { pool } from '@/transport/index';
import { reportPresence } from '@/transport/presence';
import { installCommands } from '@/wiring/commands';
import { installWindowDialogs } from '@/wiring/dialogs';
import { installSettingsSections } from '@/wiring/settings';
import { watchEveryMachine } from '@/workspace/connections';
import { liveDraftLink } from '@/workspace/draft-link';

/* What the lower layers are handed once, so none of them imports the feature that fills it. */
export interface ClientHooks {
    /* Builds the registry `perform` runs, on the first action. Asking before the hooks are installed throws. */
    readonly loadActions: () => Promise<ActionRegistry<void>>;
}

let installed: ClientHooks | null = null;
let building: Promise<ActionRegistry<void>> | null = null;

/* One registry, built once; a failed load is tried again by the next action. */
function loadActions(): Promise<ActionRegistry<void>> {
    building ??= import('@/actions/client-actions')
        .then(({ createClientActionRegistry }) => createClientActionRegistry(useDocument))
        .catch((error: unknown) => {
            building = null;

            throw error;
        });

    return building;
}

/*
 * Installs the late hooks: the loader of the action registry, the chat body of an extension, the live link of a text
 * draft and what every machine's link is watched for. Once per process, whoever calls it first: `main.tsx`,
 * the DOM harness and the unit preload all take this same wiring.
 */
export function installClientHooks(): ClientHooks {
    if (installed !== null) {
        return installed;
    }
    provideClientActionLoader(loadActions);
    provideExtensionChat();
    installCommands();
    installSettingsSections();
    installWindowDialogs();
    textDrafts.provideLinks(liveDraftLink);
    watchEveryMachine((endpointId, transport) => watchPushAttention(endpointId, transport));
    watchEveryMachine((endpointId, transport) => reportPresence(transport, () => machineAnswers(pool.statusOf(endpointId), 'presence.report')));
    watchEveryMachine((endpointId, transport) => watchSnoozes(endpointId, transport));
    watchEveryMachine((endpointId, transport) => watchNodeActivity(endpointId, transport, () => machineAnswers(pool.statusOf(endpointId), 'activity.list')));
    watchEveryMachine((endpointId, transport) => watchPrWatches(endpointId, transport));
    watchEveryMachine((endpointId, transport) => {
        const plans = new PlanSync(endpointId, transport);

        return () => plans.dispose();
    });
    installed = { loadActions };

    return installed;
}
