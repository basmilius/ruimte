import { lazyDialog } from '@adecore/ui';
import { useDevices } from '@/clients/devices/state';
import type { DialogContribution } from '@/registry/dialogs';

const EraseDeviceDialog = lazyDialog(
    () => import('@/devices/EraseDeviceDialog'),
    'EraseDeviceDialog',
    useDevices,
    (s) => s.erasing !== null
);

export const DEVICE_DIALOGS: readonly DialogContribution[] = [{ id: 'erase-device', surface: 'dialog', component: EraseDeviceDialog }];
