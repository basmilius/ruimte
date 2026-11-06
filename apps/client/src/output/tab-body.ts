import { lazyNamed } from '@adecore/ui';
import i18next from 'i18next';
import { isArtifactTab } from '@/state/files';
import { tabBody } from '@/state/tab-bodies';

export const ARTIFACT_TAB_BODY = tabBody({
    id: 'artifact',
    owns: isArtifactTab,
    failed: () => i18next.t('output:view.failed'),
    body: lazyNamed(() => import('@/output/ArtifactTabBody'), 'ArtifactTabBody')
});
