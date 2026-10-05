import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Eye, GitBranch } from 'lucide-react';
import { diagramClient, drawingClient, projectClient } from '@/project';
import { useDiagram } from '@/state/diagram';
import { useDocument } from '@/state/document';
import { useDrawing } from '@/state/drawing';
import { useProject } from '@/state/project';
import { Button, Banner } from '@adecore/ui';

// One banner slot: possible data loss outranks an agent's repeatable view request.
export function ProjectBanner() {
    const { t } = useTranslation(['shell', 'common']);
    const [retrying, setRetrying] = useState(false);
    const projectConflict = useProject((s) => s.conflict);
    const drawingConflict = useDrawing((s) => s.conflict);
    const diagramConflict = useDiagram((s) => s.conflict);
    const projectError = useProject((s) => s.error);
    const drawingError = useDrawing((s) => s.error);
    const diagramError = useDiagram((s) => s.error);
    const notice = useDocument((s) => s.viewNotice);
    const file =
        projectConflict !== null
            ? 'project'
            : drawingConflict !== null
              ? 'drawing'
              : diagramConflict !== null
                ? 'diagram'
                : projectError !== null
                  ? 'project'
                  : drawingError !== null
                    ? 'drawing'
                    : 'diagram';
    const conflict = file === 'project' ? projectConflict : file === 'drawing' ? drawingConflict : diagramConflict;
    const error = file === 'project' ? projectError : file === 'drawing' ? drawingError : diagramError;
    if (!conflict && !error) {
        return notice === null ? null : (
            <Banner icon={Eye} tone="neutral" message={notice.message}>
                <Button size="sm" onClick={() => useDocument.getState().dismissNotice()}>
                    {notice.action?.kind === 'go' ? t('projectBanner.stayHere') : t('common:action.dismiss')}
                </Button>
                {notice.action !== null && (
                    <Button size="sm" variant="primary" onClick={() => useDocument.getState().runNotice()}>
                        {notice.action.kind === 'go' ? t('projectBanner.goThere') : t('projectBanner.back')}
                    </Button>
                )}
            </Banner>
        );
    }
    const resolve = (choice: 'theirs' | 'mine'): void => {
        const client = file === 'drawing' ? drawingClient : file === 'diagram' ? diagramClient : projectClient;
        void client.resolveConflict(choice);
    };
    const retry = (): void => {
        const client = file === 'drawing' ? drawingClient : file === 'diagram' ? diagramClient : projectClient;
        setRetrying(true);
        void client
            .flush()
            .catch(() => undefined)
            .finally(() => setRetrying(false));
    };
    return conflict ? (
        <Banner icon={GitBranch} tone="attention" message={t(`projectBanner.conflict.${file}`)}>
            <Button size="sm" onClick={() => resolve('theirs')}>
                {t('projectBanner.takeTheirs')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => resolve('mine')}>
                {t('projectBanner.keepMine')}
            </Button>
        </Banner>
    ) : (
        <Banner icon={CircleAlert} tone="error" message={error}>
            <Button size="sm" disabled={retrying} onClick={retry}>
                {t('common:action.retry')}
            </Button>
        </Banner>
    );
}
