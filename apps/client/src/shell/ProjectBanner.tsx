import { AlertCircle, GitBranch } from 'lucide-react';
import { projectClient } from '@/project';
import { useProject } from '@/state/project';

const buttonClass = 'inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium';

/* Sits at the top of the canvas when the file changed under unsaved edits, or a save failed. */
export function ProjectBanner() {
    const conflict = useProject((s) => s.conflict);
    const error = useProject((s) => s.error);
    if (!conflict && !error) {
        return null;
    }
    return (
        <div className="pointer-events-auto absolute inset-x-0 top-14 z-20 flex justify-center px-4">
            <div className="float flex max-w-[640px] items-center gap-3 rounded-lg px-3 py-2 text-[12px] text-text">
                {conflict ? (
                    <>
                        <GitBranch size={14} className="shrink-0 text-status-needs-you" />
                        <span className="grow">The canvas changed on disk while you had unsaved edits.</span>
                        <button
                            className={`${buttonClass} text-text-muted hover:bg-surface-sunken hover:text-text`}
                            onClick={() => void projectClient.resolveConflict('theirs')}
                        >
                            Take the file
                        </button>
                        <button className={`${buttonClass} bg-accent text-accent-text`} onClick={() => void projectClient.resolveConflict('mine')}>
                            Keep mine
                        </button>
                    </>
                ) : (
                    <>
                        <AlertCircle size={14} className="shrink-0 text-status-error" />
                        <span className="grow">{error}</span>
                        <button
                            className={`${buttonClass} text-text-muted hover:bg-surface-sunken hover:text-text`}
                            onClick={() => useProject.getState().setError(null)}
                        >
                            Dismiss
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
