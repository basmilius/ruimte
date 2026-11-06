import { lazyDialog } from '@adecore/ui';
import { useAttentionQueue } from '@/attention/queue';
import type { DialogContribution } from '@/registry/dialogs';

const AttentionQueue = lazyDialog(
    () => import('@/attention/AttentionQueue'),
    'AttentionQueue',
    useAttentionQueue,
    (state) => state.projectKey !== null
);

export const ATTENTION_DIALOGS: readonly DialogContribution[] = [{ id: 'attention-queue', surface: 'dialog', component: AttentionQueue }];
