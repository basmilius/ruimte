import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { isSessionTab } from '@/state/files';
import { tabBody } from '@/state/tab-bodies';

/* A comparison or a snapshot of a file: a loose tab of its own that names no file of the working tree. */
export const SESSION_TAB_BODY = tabBody({
    id: 'session',
    owns: isSessionTab,
    failed: () => i18next.t('output:view.failed'),
    body: lazyNamed(() => import('@/files/SessionTabBody'), 'SessionTabBody')
});
