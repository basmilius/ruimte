import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, Copy, LoaderCircle, Trash, X } from 'lucide-react';
import { useToasts, type Toast } from '@/state/toasts';
import { Button } from '@/ui/Button';
import { FLOAT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Kbd } from '@/ui/Kbd';
import { Tooltip } from '@/ui/Tooltip';

const ICON = {
    progress: LoaderCircle,
    success: CircleCheck,
    error: CircleAlert,
    deleted: Trash
} as const;

const TONE = {
    progress: 'text-text-muted',
    success: 'text-status-idle',
    error: 'text-status-error',
    deleted: 'text-text-muted'
} as const;

/* The box is as tall as the title's own line, so what sits beside the title centers on that line. */
const TITLE_LINE = 'flex h-(--text-sm--line-height) shrink-0 items-center';

/* Nothing else in the app copies text, so the button says whether it worked instead of a toast about a toast. */
function CopyOutput({ output }: { output: string }) {
    const { t } = useTranslation('shell');
    const [copied, setCopied] = useState(false);
    return (
        <Button
            size="sm"
            variant="secondary"
            onClick={() => {
                void navigator.clipboard.writeText(output).then(() => setCopied(true));
            }}
        >
            <Icon icon={Copy} size={12} /> {copied ? t('toasts.copied') : t('toasts.copyOutput')}
        </Button>
    );
}

function ToastCard({ toast }: { toast: Toast }) {
    const { t } = useTranslation('common');
    // A toast that goes by itself keeps its close button out of sight until the pointer or the keyboard is on it.
    const leaves = toast.kind === 'deleted' || (toast.kind === 'success' && toast.persist !== true);
    return (
        <div className={`group flex items-start gap-3 rounded-[10px] py-2.5 pr-2 pl-3 ${FLOAT}`}>
            <span className={clsx(TITLE_LINE, 'w-4 justify-center')}>
                <Icon icon={ICON[toast.kind]} size={16} className={clsx(TONE[toast.kind], toast.kind === 'progress' && 'animate-spin')} />
            </span>
            <div className="flex min-w-0 grow flex-col gap-1">
                <span className="text-sm text-text">{toast.title}</span>
                {/* Wraps rather than clips: the line under the title is the one that says what went
                   wrong, and a reason cut off at the card's edge is no reason at all. */}
                {toast.description !== undefined && toast.description !== '' && (
                    <span className="text-xs break-words text-pretty text-text-muted">{toast.description}</span>
                )}
                {toast.output !== undefined && toast.output !== '' && (
                    <div className="mt-1 flex">
                        <CopyOutput output={toast.output} />
                    </div>
                )}
            </div>
            {toast.action && (
                <span className={clsx(TITLE_LINE, 'gap-2')}>
                    <button className="rounded-sm text-sm font-semibold text-text hover:text-text-muted" onClick={toast.action.run}>
                        {toast.action.label}
                    </button>
                    {toast.action.shortcut && <Kbd shortcut={toast.action.shortcut} className="font-sans text-xs text-text-faint" />}
                </span>
            )}
            <Tooltip label={t('action.dismiss')} name>
                <button
                    className={clsx(
                        'icon-btn h-(--text-sm--line-height) w-6 shrink-0',
                        leaves && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
                    )}
                    onClick={() => useToasts.getState().dismiss(toast.id)}
                >
                    <Icon icon={X} size={12} />
                </button>
            </Tooltip>
        </div>
    );
}

/*
 * Bottom right, over everything: what a git action is doing while it runs and how it went when it
 * is over, and a deletion that can still be taken back. A success takes itself away after four
 * seconds, a deletion after eight, and a failure waits to be read and carries the output of the
 * command that failed. Anything an agent has to say about a view is not here but in the banner
 * over the views, where a person looks for a decision.
 */
export function Toasts() {
    const toasts = useToasts((s) => s.toasts);
    if (toasts.length === 0) {
        return null;
    }
    return (
        <div className="fixed right-4 bottom-4 z-(--z-popup) flex w-90 max-w-[calc(100vw-32px)] flex-col gap-2" role="status" aria-live="polite">
            {toasts.map((toast) => (
                <ToastCard key={toast.id} toast={toast} />
            ))}
        </div>
    );
}
