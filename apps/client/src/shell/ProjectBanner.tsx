import { CircleAlert, GitBranch } from 'lucide-react';
import { drawingClient, projectClient } from '@/project';
import { useDrawing } from '@/state/drawing';
import { useProject } from '@/state/project';
import { Button } from '@/ui/Button';
import { FLOAT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

/* Floats at the top of the canvas, under the toolbar, when the file changed under unsaved edits or a save failed. */
export function ProjectBanner() {
    const projectConflict = useProject((s) => s.conflict);
    const drawingConflict = useDrawing((s) => s.conflict);
    const projectError = useProject((s) => s.error);
    const drawingError = useDrawing((s) => s.error);
    // One banner for both files: the wording is the same and two of them would stack.
    const drawing = drawingConflict !== null || (drawingError !== null && projectError === null);
    const conflict = projectConflict ?? drawingConflict;
    const error = projectError ?? drawingError;
    if (!conflict && !error) {
        return null;
    }
    const resolve = (choice: 'theirs' | 'mine'): void => void (drawing ? drawingClient.resolveConflict(choice) : projectClient.resolveConflict(choice));
    const dismiss = (): void => (drawing ? useDrawing.getState().setError(null) : useProject.getState().setError(null));
    return (
        <div className="pointer-events-auto absolute inset-x-0 top-3 z-20 flex justify-center px-4" role="status" aria-live="polite">
            <div className={`${FLOAT} flex max-w-[640px] items-center gap-3 rounded-lg px-3 py-2 text-sm text-text`}>
                {conflict ? (
                    <>
                        <Icon icon={GitBranch} size={16} className="shrink-0 text-status-needs-you" />
                        <span className="grow">The {drawing ? 'drawing' : 'canvas'} changed on disk while you had unsaved edits.</span>
                        <Button size="sm" onClick={() => resolve('theirs')}>
                            Take the file
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => resolve('mine')}>
                            Keep mine
                        </Button>
                    </>
                ) : (
                    <>
                        <Icon icon={CircleAlert} size={16} className="shrink-0 text-status-error" />
                        <span className="grow">{error}</span>
                        <Button size="sm" onClick={dismiss}>
                            Dismiss
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
