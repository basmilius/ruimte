import { Button, Checkbox, PromptDialog } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktop, type MachineStopPreview } from '@/desktop/bridge';
import { isShellFailure } from '@/desktop/shell-failure';
import { stopRunningLines } from '@/machine-ui/background-service';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { transportFor } from '@/transport/index';
import { leaveAccount } from '@/workspace/account-machines';

/*
 * The way back to an app that only connects. It stops the machine this app runs, keeps what it holds
 * in the Ruimte folder, and can take the machine off the account before the restart.
 */
export function StopMachineRow() {
    const { t } = useTranslation('settings');
    const [open, setOpen] = useState(false);
    const [preview, setPreview] = useState<MachineStopPreview | null>(null);
    const [leave, setLeave] = useState(false);
    // A retry after `choose` failed must not ask the account to let go of a machine that already left.
    const left = useRef(false);
    const local = useEndpoints((s) => s.endpoints.find((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID));
    const label = local?.label ?? '';
    const accountId = useServers((s) => s.byEndpoint[LOCAL_ENDPOINT_ID]?.accountId);
    const reachable = transportFor(LOCAL_ENDPOINT_ID) !== null;

    useEffect(() => {
        const machine = desktop()?.machine;
        if (!open || machine === undefined) {
            return;
        }
        let alive = true;
        machine
            .stopPreview()
            .then((answer) => {
                if (alive) {
                    setPreview(answer);
                }
            })
            // A machine that cannot say what runs still gets its question, without the sentences about what ends and where it stays.
            .catch(() => {
                if (alive) {
                    setPreview({ work: null, home: '', commandLine: false });
                }
            });
        return () => {
            alive = false;
        };
    }, [open]);

    const openDialog = (): void => {
        setPreview(null);
        setOpen(true);
    };

    const close = (next: boolean): void => {
        setOpen(next);
        if (!next) {
            setLeave(false);
        }
    };

    const confirm = async (): Promise<void> => {
        const machine = desktop()?.machine;
        if (machine === undefined) {
            throw new Error(t('backgroundService.confirmStopRunning.failed'));
        }
        if (leave && reachable && !left.current) {
            await leaveAccount(LOCAL_ENDPOINT_ID, local?.daemonId ?? LOCAL_ENDPOINT_ID);
            left.current = true;
        }
        try {
            await machine.choose('none');
        } catch (e) {
            throw isShellFailure(e) ? new Error(t('backgroundService.confirmStopRunning.failed')) : e;
        }
    };

    return (
        <>
            <SettingsRow
                searchId="machines.machine.stopRunning"
                label={t('backgroundService.stopRunning.label')}
                description={t('backgroundService.stopRunning.description')}
                control={
                    <Button variant="secondary" onClick={openDialog}>
                        {t('backgroundService.stopRunning.action')}
                    </Button>
                }
            />
            <PromptDialog
                open={open}
                nested
                danger
                title={t('backgroundService.confirmStopRunning.title')}
                description={stopRunningLines(preview).join(' ')}
                confirmLabel={t('backgroundService.confirmStopRunning.action')}
                confirmBusyLabel={t('backgroundService.confirmStopRunning.busy')}
                confirmDisabled={preview === null}
                onConfirm={confirm}
                onOpenChange={close}
            >
                {typeof accountId === 'string' && (
                    <div className="flex flex-col gap-1.5">
                        <label className="flex items-center gap-2 text-sm text-text">
                            <Checkbox
                                checked={leave && reachable}
                                disabled={!reachable}
                                onCheckedChange={setLeave}
                                label={t('backgroundService.confirmStopRunning.leave', { machine: label })}
                            />
                            {t('backgroundService.confirmStopRunning.leave', { machine: label })}
                        </label>
                        {!reachable && <p className="text-xs text-text-muted">{t('backgroundService.confirmStopRunning.unreachable')}</p>}
                    </div>
                )}
            </PromptDialog>
        </>
    );
}
