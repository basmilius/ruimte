import { CircleAlert, Eye, GitBranch } from 'lucide-react';
import { diagramClient, drawingClient, projectClient } from '@/project';
import { Banner } from '@/shell/Banner';
import { focusedDiagram, useDiagram } from '@/state/diagram';
import { useDocument } from '@/state/document';
import { focusedDrawing, useDrawing } from '@/state/drawing';
import { useProject } from '@/state/project';
import { Button } from '@/ui/Button';

/*
 * Floats at the top of the canvas, under the toolbar: the file that changed under unsaved edits, the
 * save that failed, and whatever an agent's `open` has to say, which is one line in either setting.
 * One slot, and the order is what it costs to miss it: work that may be lost comes before a view that
 * can be shown again, so the agent's line waits until the file is settled rather than stacking under
 * it. The two agent lines can never be up at once, since one is the setting on and the other off.
 */
export function ProjectBanner() {
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
                    {notice.action?.kind === 'go' ? 'Stay here' : 'Dismiss'}
                </Button>
                {notice.action !== null && (
                    <Button size="sm" variant="primary" onClick={() => useDocument.getState().runNotice()}>
                        {notice.action.kind === 'go' ? 'Go there' : 'Back'}
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
        <Banner icon={GitBranch} tone="attention" message={`The ${file} changed on disk while you had unsaved edits.`}>
            <Button size="sm" onClick={() => resolve('theirs')}>
                Take the file
            </Button>
            <Button size="sm" variant="primary" onClick={() => resolve('mine')}>
                Keep mine
            </Button>
        </Banner>
    ) : (
        <Banner icon={CircleAlert} tone="error" message={error}>
            <Button size="sm" onClick={dismiss}>
                Dismiss
            </Button>
        </Banner>
    );
}
