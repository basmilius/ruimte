import { PromptDialog } from '@adecore/ui';
import { Eraser } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDevices } from '@/clients/devices/state';
import { eraseDevice } from '@/devices/control';
import { deviceClientFor } from '@/workspace/connections';

/* The question before a simulator or an emulator loses its apps, their data and its settings. */
export function EraseDeviceDialog() {
    const { t } = useTranslation('machines');
    const request = useDevices((state) => state.erasing);
    const close = (): void => useDevices.getState().askErase(null);
    const name = request?.device.name ?? '';
    const confirm = async (): Promise<void> => {
        const client = request === null ? null : deviceClientFor(request.endpointId);
        if (request === null || client === null) {
            return;
        }
        await eraseDevice(client, request.device);
        close();
    };
    return (
        <PromptDialog
            open={request !== null}
            title={t('device.erase.title', { name })}
            titleIcon={Eraser}
            description={t('device.erase.description', { name })}
            confirmLabel={t('device.erase.confirm')}
            confirmBusyLabel={t('device.erase.busy')}
            fallbackMessage={t('device.erase.failed')}
            danger
            onConfirm={confirm}
            onOpenChange={close}
        />
    );
}
