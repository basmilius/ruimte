import type { ReactNode } from 'react';
import clsx from 'clsx';
import { RotateCw } from 'lucide-react';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

interface NodeNoticeProps {
    tone?: 'muted' | 'error';
    children: ReactNode;
    /* Present when the notice is something the reader can act on; draws the retry button. */
    onRetry?: () => void;
    retryLabel?: string;
}

/* The card a node floats over its own content when it cannot show that content: connecting,
   failed to start, the page did not load. One shape for all three, so a terminal, a chat and a
   browser report trouble the same way. */
export function NodeNotice({ tone = 'muted', children, onRetry, retryLabel = 'Try again' }: NodeNoticeProps) {
    return (
        <div
            className={clsx(
                'absolute inset-x-3 top-3 z-10 flex items-center gap-3 rounded-lg border border-border bg-surface-raised/90 px-3 py-2 text-xs',
                tone === 'error' ? 'text-status-error' : 'text-text-muted',
                !onRetry && 'pointer-events-none'
            )}
            role={tone === 'error' ? 'alert' : 'status'}
        >
            <span className="grow select-text">{children}</span>
            {onRetry && (
                <Tooltip label={retryLabel} name>
                    <button className="icon-btn h-7 w-7 shrink-0" onClick={onRetry}>
                        <Icon icon={RotateCw} size={16} />
                    </button>
                </Tooltip>
            )}
        </div>
    );
}
