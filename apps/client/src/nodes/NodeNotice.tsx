import { useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Copy, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { copyText } from '@ruimte/ui/clipboard';
import { Icon } from '@ruimte/ui/Icon';
import { TextMenu } from '@ruimte/ui/TextMenu';
import { Tooltip } from '@ruimte/ui/Tooltip';

interface NodeNoticeProps {
    tone?: 'muted' | 'error';
    children: ReactNode;
    /* Present when the notice is something the reader can act on; draws the retry button. */
    onRetry?: () => void;
    /* Overrides the button's name where a retry is something more precise than trying again. */
    retryLabel?: string;
}

/* The card a node floats over its own content when it cannot show that content: connecting,
   failed to start, the page did not load. One shape for all three, so a terminal, a chat and a
   browser report trouble the same way. */
export function NodeNotice({ tone = 'muted', children, onRetry, retryLabel }: NodeNoticeProps) {
    const { t } = useTranslation('canvas');
    const message = useRef<HTMLSpanElement>(null);
    const className = clsx(
        'absolute inset-x-3 top-3 z-10 flex items-center gap-3 rounded-lg border border-border bg-surface-raised/90 px-3 py-2 text-sm',
        tone === 'error' ? 'text-status-error' : 'text-text-muted',
        !onRetry && 'pointer-events-none'
    );
    const content = (
        <>
            <span ref={message} className="grow select-text">
                {children}
            </span>
            {onRetry && (
                <Tooltip label={retryLabel ?? t('common:action.retry')} name>
                    <button className="icon-btn icon-btn-sm" onClick={onRetry}>
                        <Icon icon={RotateCw} size={14} />
                    </button>
                </Tooltip>
            )}
        </>
    );
    if (tone !== 'error') {
        return (
            <div className={className} role="status">
                {content}
            </div>
        );
    }
    // An error is a sentence to paste into a report or hand to an agent, so it copies whole as well.
    return (
        <TextMenu
            className={className}
            role="alert"
            items={
                <ContextMenu.Item className="menu-item" onClick={() => copyText(message.current?.textContent ?? '')}>
                    <Icon icon={Copy} size={14} /> {t('common:action.copyError')}
                </ContextMenu.Item>
            }
        >
            {content}
        </TextMenu>
    );
}
