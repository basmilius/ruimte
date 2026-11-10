import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { isDatabaseTab } from '@/state/files';
import { tabBody } from '@/state/tab-bodies';

export const DATABASE_TAB_BODY = tabBody({
    id: 'database',
    owns: isDatabaseTab,
    failed: () => i18next.t('databases:tab.failed'),
    body: lazyNamed(() => import('@/database/DatabaseTabBody'), 'DatabaseTabBody')
});
