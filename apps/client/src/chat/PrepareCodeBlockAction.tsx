import type { ShellCodeBlockContext } from '@adecore/agents-react/host';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary, IconButton, lazyNamed } from '@adecore/ui';
import { SquareTerminal } from 'lucide-react';
import type { TerminalPreparePreview } from '@ruimte/contracts';
import { preparableShell } from '@/chat/preparable-shell';
import { performAsPerson } from '@/actions/client-actions';
import { endpointById } from '@/state/endpoints';
import { useToasts } from '@/state/toasts';
import { prepareDestination, type PrepareDestination } from '@/terminal/prepare-destination';

const PrepareTerminalDialog = lazyNamed(() => import('./PrepareTerminalDialog'), 'PrepareTerminalDialog');

export function PrepareCodeBlockAction({ context }: { context: ShellCodeBlockContext }) {
    const { t } = useTranslation('chat');
    const working = useRef(false);
    const destination = useRef<PrepareDestination | null>(null);
    useEffect(() => () => destination.current?.dispose(), []);
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<{ endpointId: string; result: TerminalPreparePreview; destination: PrepareDestination | null } | null>(null);
    const language = preparableShell(context);
    if (language === null) {
        return null;
    }

    async function open(): Promise<void> {
        if (working.current || language === null) {
            return;
        }
        working.current = true;
        setBusy(true);
        try {
            const endpointId = context.scopeId;
            const machineId = endpointById(endpointId)?.daemonId;
            if (!machineId) {
                throw new Error(t('prepare.offline'));
            }
            destination.current?.dispose();
            const scope = prepareDestination(endpointId, machineId);
            destination.current = scope;
            await scope?.attach();
            if (scope && !scope.current()) {
                return;
            }
            const result = await performAsPerson('terminal.preparePreview', {
                endpointId,
                machineId,
                chatId: context.chatId,
                itemId: context.itemId,
                language,
                code: context.code
            });
            if (scope && !scope.current()) {
                return;
            }
            setPreview({ endpointId, result, destination: scope });
        } catch (error) {
            destination.current?.dispose();
            useToasts.getState().show({ kind: 'error', title: t('prepare.failed'), description: error instanceof Error ? error.message : t('prepare.failed') });
        } finally {
            working.current = false;
            setBusy(false);
        }
    }

    return (
        <>
            <IconButton
                icon={SquareTerminal}
                size="sm"
                label={t('prepare.action')}
                busy={busy}
                aria-busy={busy}
                aria-disabled={busy}
                onClick={() => void open()}
            />
            {preview !== null && (
                <ErrorBoundary label={t('prepare.action')} key={preview.result.targets[0]?.token ?? 'empty'}>
                    <PrepareTerminalDialog
                        endpointId={preview.endpointId}
                        preview={preview.result}
                        destination={preview.destination}
                        close={() => {
                            destination.current?.dispose();
                            setPreview(null);
                        }}
                    />
                </ErrorBoundary>
            )}
        </>
    );
}
