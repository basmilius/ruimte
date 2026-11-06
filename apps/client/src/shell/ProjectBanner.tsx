import { Button, Banner } from '@adecore/ui';
import { CircleAlert, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diagramClient, drawingClient, projectClient } from '@/project';
import { useDiagram } from '@/state/diagram';
import { useDrawing } from '@/state/drawing';
import { useProject } from '@/state/project';

// One banner slot: a conflict outranks a failed save, since only the conflict can lose edits.
export function ProjectBanner() {
    const { t } = useTranslation(['shell', 'common']);
    const [retrying, setRetrying] = useState(false);
    const projectConflict = useProject((s) => s.conflict);
    const drawingConflict = useDrawing((s) => s.conflict);
    const diagramConflict = useDiagram((s) => s.conflict);
    const projectError = useProject((s) => s.error);
    const drawingError = useDrawing((s) => s.error);
    const diagramError = useDiagram((s) => s.error);
    const files = [
        { file: 'project', client: projectClient, conflict: projectConflict, error: projectError },
        { file: 'drawing', client: drawingClient, conflict: drawingConflict, error: drawingError },
        { file: 'diagram', client: diagramClient, conflict: diagramConflict, error: diagramError }
    ] as const;
    const shown = files.find((entry) => entry.conflict !== null) ?? files.find((entry) => entry.error !== null);
    if (!shown?.conflict && !shown?.error) {
        return null;
    }
    const { file, client, conflict, error } = shown;
    const resolve = (choice: 'theirs' | 'mine'): void => void client.resolveConflict(choice);
    const retry = (): void => {
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
