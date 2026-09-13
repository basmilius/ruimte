import { useState } from 'react';
import clsx from 'clsx';
import { Check, CircleAlert, Copy, Eye, LoaderCircle, X } from 'lucide-react';
import { useToasts, type Toast } from '@/state/toasts';
import { Button } from '@/ui/Button';
import { FLOAT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const ICON = {
    progress: LoaderCircle,
    success: Check,
    error: CircleAlert,
    notice: Eye
} as const;

const TONE = {
    progress: 'text-text-muted',
    success: 'text-status-idle',
    error: 'text-status-error',
    notice: 'text-text-muted'
} as const;

/* Nothing else in the app copies text, so the button says whether it worked instead of a toast about a toast. */
function CopyOutput({ output }: { output: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            size="sm"
            variant="secondary"
            onClick={() => {
                void navigator.clipboard.writeText(output).then(() => setCopied(true));
            }}
        >
            <Icon icon={Copy} size={12} /> {copied ? 'Copied' : 'Copy output'}
        </Button>
    );
}

function ToastCard({ toast }: { toast: Toast }) {
    return (
        <div className={`flex items-start gap-2 rounded-[10px] p-2.5 pl-3 ${FLOAT}`}>
            {/* The box is as tall as the title's own line, so the mark centers on that line instead
               of on a square that is a little shorter than it. */}
            <span className="grid h-[var(--text-sm--line-height)] w-5 shrink-0 place-items-center">
                <Icon icon={ICON[toast.kind]} size={16} className={clsx(TONE[toast.kind], toast.kind === 'progress' && 'animate-spin')} />
            </span>
            <div className="flex min-w-0 grow flex-col gap-1">
                <span className="text-sm font-medium text-text">{toast.title}</span>
                {/* Wraps rather than clips: the line under the title is the one that says what went
                   wrong, and a reason cut off at the card's edge is no reason at all. */}
                {toast.description !== undefined && toast.description !== '' && (
                    <span className="text-xs break-words text-pretty text-text-muted">{toast.description}</span>
                )}
                {(toast.action || toast.output) && (
                    <div className="mt-1 flex items-center gap-2">
                        {toast.action && (
                            <Button size="sm" variant="secondary" onClick={toast.action.run}>
                                {toast.action.label}
                            </Button>
                        )}
                        {toast.output !== undefined && toast.output !== '' && <CopyOutput output={toast.output} />}
                    </div>
                )}
            </div>
            <Tooltip label="Dismiss" name>
                <button className="icon-btn -mt-1 -mr-1 h-6 w-6 shrink-0" onClick={() => useToasts.getState().dismiss(toast.id)}>
                    <Icon icon={X} size={12} />
                </button>
            </Tooltip>
        </div>
    );
}

/*
 * Bottom right, over everything: what a git action is doing while it runs and how it went when it
 * is over. A success takes itself away after four seconds, a failure waits to be read and carries
 * the output of the command that failed, and a notice (an agent that asked for a view) waits too,
 * because the button on it is the whole point of the card.
 */
export function Toasts() {
    const toasts = useToasts((s) => s.toasts);
    if (toasts.length === 0) {
        return null;
    }
    return (
        <div className="fixed right-4 bottom-4 z-[var(--z-popup)] flex w-90 max-w-[calc(100vw-32px)] flex-col gap-2" role="status" aria-live="polite">
            {toasts.map((toast) => (
                <ToastCard key={toast.id} toast={toast} />
            ))}
        </div>
    );
}
