import { useState } from 'react';
import clsx from 'clsx';
import { Check, CircleAlert, Copy, LoaderCircle, X } from 'lucide-react';
import { useToasts, type Toast } from '@/state/toasts';
import { Button } from '@/ui/Button';
import { FLOAT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const ICON = {
    progress: LoaderCircle,
    success: Check,
    error: CircleAlert
} as const;

const TONE = {
    progress: 'text-text-muted',
    success: 'text-status-idle',
    error: 'text-status-error'
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
            {/* The same box the menu rows use, so the mark lands on the title's line and not above it. */}
            <span className="grid h-5 w-4 shrink-0 place-items-center">
                <Icon icon={ICON[toast.kind]} size={14} className={clsx(TONE[toast.kind], toast.kind === 'progress' && 'animate-spin')} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
                <span className="text-xs font-medium text-text">{toast.title}</span>
                {toast.description !== undefined && toast.description !== '' && (
                    <span className="truncate font-mono text-xs text-text-muted">{toast.description}</span>
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
 * the output of the command that failed.
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
