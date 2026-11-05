import { CliMark } from '@adecore/agents-react/providers';
import { Button, CloseButton, Dialog, Icon } from '@adecore/ui';
import { RotateCw } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CliSession } from '@/chat/cli-session';
import { useSettings } from '@/state/settings';
import { NodeNotice } from '@/surface/nodes/NodeNotice';
import { MachineTerminal } from '@/terminal/MachineTerminal';
import { sessionClientFor } from '@/workspace/connections';

/*
 * The dialog a CLI session draws in. Mounted once beside the other dialogs, and `nested` puts it over
 * whichever of them asked.
 */
export function CliTerminalDialog<T>({
    request,
    keyOf,
    close,
    children
}: {
    request: T | null;
    keyOf(request: T): string;
    close(): void;
    children(request: T, onRetry: () => void): ReactNode;
}) {
    // What the popup keeps showing while it animates closed, after the request is gone.
    const [shown, setShown] = useState(request);
    const [attempt, setAttempt] = useState(0);
    if (request !== null && request !== shown) {
        setShown(request);
    }

    return (
        <Dialog.Root open={request !== null} onOpenChange={(next) => (next ? undefined : close())}>
            <Dialog.Popup
                nested
                className="flex h-[520px] w-[760px] flex-col"
                onKeyDown={(e) => {
                    // Every open dialog root listens for Escape on the document, so without this one press would close the one underneath too.
                    if (e.key === 'Escape') {
                        e.stopPropagation();
                        close();
                    }
                }}
            >
                {shown !== null && <Fragment key={`${keyOf(shown)}:${attempt}`}>{children(shown, () => setAttempt((count) => count + 1))}</Fragment>}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

export function CliTerminalFrame({
    session,
    endpointId,
    kind,
    title,
    description,
    failed,
    ended,
    close,
    onRetry,
    footer
}: {
    session: CliSession;
    endpointId: string;
    kind: string;
    title: ReactNode;
    description: ReactNode;
    failed(reason: string): ReactNode;
    ended(dropped: boolean): ReactNode;
    close(): void;
    onRetry(): void;
    footer?: ReactNode;
}) {
    const { t } = useTranslation(['canvas', 'common']);
    const fontSize = useSettings((s) => s.fontSize);
    const lineHeight = useSettings((s) => s.terminalLineHeight);
    const { phase, connected, sessionId, viewRef, started } = session;

    return (
        <>
            <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-hover">
                    <CliMark kind={kind} size={16} />
                </span>
                <div className="min-w-0 grow">
                    <Dialog.Title className="truncate">{title}</Dialog.Title>
                    <Dialog.Description size="xs">{description}</Dialog.Description>
                </div>
                <CloseButton label={t('common:action.close')} dialog />
            </div>
            <div className="relative min-h-0 grow bg-term-bg">
                <MachineTerminal
                    ref={viewRef}
                    endpointId={endpointId}
                    className="absolute inset-0"
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                    onData={(data) => sessionClientFor(endpointId)?.write(sessionId, data)}
                    onResize={(cols, rows) => {
                        if (started.current) {
                            sessionClientFor(endpointId)?.resize(sessionId, cols, rows);
                        }
                    }}
                />
                {phase.kind === 'starting' && !connected && <NodeNotice>{t('canvas:notice.connecting')}</NodeNotice>}
                {phase.kind === 'failed' && (
                    <NodeNotice tone="error" onRetry={onRetry}>
                        {failed(phase.reason)}
                    </NodeNotice>
                )}
            </div>
            {footer}
            {phase.kind === 'ended' && (
                <div className="flex items-center gap-2 border-t border-border px-5 py-3">
                    <span className="grow text-xs text-text-muted">{ended(phase.dropped)}</span>
                    <Button variant="secondary" onClick={onRetry}>
                        <Icon icon={RotateCw} size={12} /> {t('common:action.retry')}
                    </Button>
                    <Button onClick={close}>{t('common:action.close')}</Button>
                </div>
            )}
        </>
    );
}
