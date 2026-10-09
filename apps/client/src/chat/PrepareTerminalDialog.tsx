import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionRefusal } from '@ruimte/actions';
import { Button, Dialog } from '@adecore/ui';
import type { TerminalPreparePreview } from '@ruimte/contracts';
import { performAsPerson } from '@/actions/client-actions';
import { useToasts } from '@/state/toasts';
import type { PrepareDestination } from '@/terminal/prepare-destination';

export function PrepareTerminalDialog({
    endpointId,
    preview,
    destination,
    close
}: {
    endpointId: string;
    preview: TerminalPreparePreview;
    destination: PrepareDestination | null;
    close(): void;
}) {
    const { t } = useTranslation('chat');
    const { t: common } = useTranslation();
    const [open, setOpen] = useState(true);
    const [inserted, setInserted] = useState(false);
    const prepared = useRef<string | null>(null);
    const [token, setToken] = useState(preview.targets[0]?.token ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const working = useRef(false);

    async function prepare(): Promise<void> {
        if (working.current || !token || error !== null) {
            return;
        }
        working.current = true;
        setBusy(true);
        try {
            if (destination && !destination.current()) {
                close();
                return;
            }
            const result = await performAsPerson('terminal.prepare', { endpointId, machineId: preview.machineId, token });
            setInserted(true);
            useToasts.getState().show({
                kind: 'success',
                title: t('prepare.ready'),
                description: t('prepare.readyIn', { terminal: preview.targets.find((target) => target.token === token)?.title ?? '' })
            });
            if (!destination || (await destination.confirmed(result.sessionId))) {
                prepared.current = result.sessionId;
            }
            setOpen(false);
        } catch (error) {
            setError(
                error instanceof ActionRefusal && error.code === 'terminal-prepare-unconfirmed'
                    ? t('prepare.unconfirmed')
                    : error instanceof ActionRefusal && error.code === 'terminal-editor-refused'
                      ? t('prepare.refused')
                      : error instanceof Error
                        ? error.message
                        : t('prepare.failed')
            );
        } finally {
            working.current = false;
            setBusy(false);
        }
    }

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(next) => !next && !working.current && close()}
            onOpenChangeComplete={(next) => {
                if (!next) {
                    if (prepared.current) {
                        destination?.reveal(prepared.current);
                    }
                    close();
                }
            }}
        >
            <Dialog.Popup size="sm" finalFocus={() => !inserted && (destination?.canRestoreFocus() ?? true)}>
                <Dialog.Title>{t('prepare.action')}</Dialog.Title>
                <Dialog.Text className="mt-2">{t('prepare.explanation')}</Dialog.Text>
                <dl className="mt-4 space-y-2 text-sm">
                    <div>
                        <dt className="text-text-muted">{t('prepare.machine')}</dt>
                        <dd className="break-all">{preview.machine}</dd>
                    </div>
                    <div>
                        <dt className="text-text-muted">{t('prepare.cwd')}</dt>
                        <dd className="break-all font-mono">{preview.cwd}</dd>
                    </div>
                </dl>
                <pre className="my-4 whitespace-pre-wrap break-all rounded-lg border border-border p-3 text-sm">
                    <code>{preview.command}</code>
                </pre>
                {preview.targets.length === 0 ? (
                    <Dialog.Text>{t('prepare.noShell')}</Dialog.Text>
                ) : (
                    <fieldset disabled={busy} className="space-y-2">
                        <legend className="mb-2 text-sm text-text-muted">{t('prepare.terminal')}</legend>
                        {preview.targets.map((target) => (
                            <label key={target.token} className="flex items-center gap-2 text-sm">
                                <input
                                    type="radio"
                                    name="prepare-terminal"
                                    value={target.token}
                                    checked={token === target.token}
                                    onChange={() => setToken(target.token)}
                                />
                                <span className="break-all">{target.title}</span>
                            </label>
                        ))}
                    </fieldset>
                )}
                {error !== null && (
                    <p role="alert" className="mt-3 text-sm text-text-muted">
                        {error}
                    </p>
                )}
                <Dialog.Footer>
                    <Button disabled={busy} onClick={close}>
                        {common('action.cancel')}
                    </Button>
                    <Button variant="primary" disabled={busy || !token || error !== null} onClick={() => void prepare()}>
                        {t('prepare.paste')}
                    </Button>
                </Dialog.Footer>
            </Dialog.Popup>
        </Dialog.Root>
    );
}
