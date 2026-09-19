import { useTranslation } from 'react-i18next';
import { CircleAlert, Eye, GitBranch } from 'lucide-react';
import { diagramClient, drawingClient, projectClient } from '@/project';
import { Banner } from '@/shell/Banner';
import { focusedDiagram, useDiagram } from '@/state/diagram';
import { useDocument } from '@/state/document';
import { focusedDrawing, useDrawing } from '@/state/drawing';
import { useProject } from '@/state/project';
import { Button } from '@/ui/Button';

// One banner slot: possible data loss outranks an agent's repeatable view request.
export function ProjectBanner() {
    const { t } = useTranslation(['shell', 'common']);
    const projectConflict = useProject((s) => s.conflict);
    const drawingConflict = useDrawing((s) => s.conflict);
    const diagramConflict = useDiagram((s) => s.conflict);
    const projectError = useProject((s) => s.error);
    const drawingError = useDrawing((s) => s.error);
    const diagramError = useDiagram((s) => s.error);
    const notice = useDocument((s) => s.viewNotice);
    // One banner for every file: the wording is the same and several of them would stack.
    const file =
        drawingConflict !== null || (drawingError !== null && projectError === null)
            ? 'drawing'
            : diagramConflict !== null || (diagramError !== null && projectError === null)
              ? 'diagram'
              : 'canvas';
    const conflict = projectConflict ?? drawingConflict ?? diagramConflict;
    const error = projectError ?? drawingError ?? diagramError;
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
    const dismiss = (): void => {
        if (file === 'drawing') {
            focusedDrawing().getState().setError(null);
        } else if (file === 'diagram') {
            focusedDiagram().getState().setError(null);
        } else {
            useProject.getState().setError(null);
        }
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
            <Button size="sm" onClick={dismiss}>
                {t('common:action.dismiss')}
            </Button>
        </Banner>
    );
}
