import { Button, copyText, Icon, IconButton, TextMenu, ContextMenu } from '@adecore/ui';
import clsx from 'clsx';
import { Copy, RotateCw } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TransportStatus } from '@/transport/index';

interface NodeNoticeProps {
    tone?: 'muted' | 'error';
    children: ReactNode;
    /* Present when the notice is something the reader can act on; draws the retry button. */
    onRetry?: () => void;
    /* Overrides the button's name where a retry is something more precise than trying again. */
    retryLabel?: string;
    /* A way out the reader takes elsewhere, such as the settings that fix what the notice says. */
    action?: { label: string; onClick(): void };
}

/* The card a node floats over its own content when it cannot show it, one shape for every kind of node. */
export function NodeNotice({ tone = 'muted', children, onRetry, retryLabel, action }: NodeNoticeProps) {
    const { t } = useTranslation('canvas');
    const message = useRef<HTMLSpanElement>(null);
    const className = clsx(
        'absolute inset-x-3 top-3 z-10 flex items-center gap-3 rounded-lg border border-border bg-surface-raised/90 px-3 py-2 text-sm',
        tone === 'error' ? 'text-status-error' : 'text-text-muted',
        !onRetry && !action && 'pointer-events-none'
    );
    const content = (
        <>
            <span ref={message} className="grow select-text">
                {children}
            </span>
            {action && (
                <Button size="sm" variant="secondary" onClick={action.onClick}>
                    {action.label}
                </Button>
            )}
            {onRetry && <IconButton icon={RotateCw} size="sm" label={retryLabel ?? t('common:action.retry')} onClick={onRetry} />}
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
                <ContextMenu.Item onClick={() => copyText(message.current?.textContent ?? '')}>
                    <Icon icon={Copy} size={14} /> {t('common:action.copyError')}
                </ContextMenu.Item>
            }
        >
            {content}
        </TextMenu>
    );
}

/* What a body says while its machine's socket is not open. */
export function ConnectionNotice({ status }: { status: TransportStatus }) {
    const { t } = useTranslation('canvas');
    if (status === 'open') {
        return null;
    }
    return <NodeNotice>{status === 'closed' ? t('notice.reconnecting') : t('notice.connecting')}</NodeNotice>;
}
