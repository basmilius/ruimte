import { lazyDialog } from '@adecore/ui';
import type { DialogContribution } from '@/registry/dialogs';
import { useConsent } from '@/state/consent';

const ConsentDialog = lazyDialog(
    () => import('@/tunnels/ConsentDialog'),
    'ConsentDialog',
    useConsent,
    (s) => s.requests.length > 0
);

/* A client elsewhere waits for a person on this machine, wherever the window is. */
export const TUNNEL_DIALOGS: readonly DialogContribution[] = [{ id: 'consent', surface: 'consent', component: ConsentDialog }];
