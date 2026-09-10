import { CircleAlert, GitBranch } from 'lucide-react';
import { projectClient } from '@/project';
import { useProject } from '@/state/project';
import { Button } from '@/ui/Button';
import { FLOAT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

/* Floats at the top of the canvas, under the toolbar, when the file changed under unsaved edits or a save failed. */
export function ProjectBanner() {
    const conflict = useProject((s) => s.conflict);
    const error = useProject((s) => s.error);
    if (!conflict && !error) {
        return null;
    }
    return (
        <div className="pointer-events-auto absolute inset-x-0 top-3 z-20 flex justify-center px-4" role="status" aria-live="polite">
            <div className={`${FLOAT} flex max-w-[640px] items-center gap-3 rounded-lg px-3 py-2 text-xs text-text`}>
                {conflict ? (
                    <>
                        <Icon icon={GitBranch} size={12} className="shrink-0 text-status-needs-you" />
                        <span className="grow">The canvas changed on disk while you had unsaved edits.</span>
                        <Button size="sm" onClick={() => void projectClient.resolveConflict('theirs')}>
                            Take the file
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => void projectClient.resolveConflict('mine')}>
                            Keep mine
                        </Button>
                    </>
                ) : (
                    <>
                        <Icon icon={CircleAlert} size={12} className="shrink-0 text-status-error" />
                        <span className="grow">{error}</span>
                        <Button size="sm" onClick={() => useProject.getState().setError(null)}>
                            Dismiss
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
