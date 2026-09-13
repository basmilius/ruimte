import { CircleAlert, Eye, GitBranch } from 'lucide-react';
import { drawingClient, projectClient } from '@/project';
import { Banner } from '@/shell/Banner';
import { useDocument } from '@/state/document';
import { useDrawing } from '@/state/drawing';
import { useProject } from '@/state/project';
import { Button } from '@/ui/Button';

/*
 * Floats at the top of the canvas, under the toolbar: the file that changed under unsaved edits, the
 * save that failed, and the view an agent asked for while the setting that follows one is off. One
 * slot, and the order is what it costs to miss it: work that may be lost comes before a request that
 * can be made again, so the agent's line waits until the file is settled rather than stacking under it.
 */
export function ProjectBanner() {
    const projectConflict = useProject((s) => s.conflict);
    const drawingConflict = useDrawing((s) => s.conflict);
    const projectError = useProject((s) => s.error);
    const drawingError = useDrawing((s) => s.error);
    const asked = useDocument((s) => s.askedView);
    // One banner for both files: the wording is the same and two of them would stack.
    const drawing = drawingConflict !== null || (drawingError !== null && projectError === null);
    const conflict = projectConflict ?? drawingConflict;
    const error = projectError ?? drawingError;
    if (!conflict && !error) {
        return asked === null ? null : (
            <Banner icon={Eye} tone="neutral" message={asked.message}>
                <Button size="sm" onClick={() => useDocument.getState().dismissAskedView()}>
                    Stay here
                </Button>
                <Button size="sm" variant="primary" onClick={() => useDocument.getState().goToAskedView()}>
                    Go there
                </Button>
            </Banner>
        );
    }
    const resolve = (choice: 'theirs' | 'mine'): void => void (drawing ? drawingClient.resolveConflict(choice) : projectClient.resolveConflict(choice));
    const dismiss = (): void => (drawing ? useDrawing.getState().setError(null) : useProject.getState().setError(null));
    return conflict ? (
        <Banner icon={GitBranch} tone="attention" message={`The ${drawing ? 'drawing' : 'canvas'} changed on disk while you had unsaved edits.`}>
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
