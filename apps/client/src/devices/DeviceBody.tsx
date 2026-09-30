import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Hand, House, LoaderCircle, Lock, Mic, RotateCcw, RotateCw, Smartphone, Undo2, type LucideIcon } from 'lucide-react';
import { deviceButtons, type DeviceButton, type DeviceInfo, type DeviceInput, type DeviceReference } from '@ruimte/contracts';
import { useNodeHost } from '@/nodes/node-host';
import { useDeviceList, useResolvedDevice } from '@/devices/state';
import { DeviceStream } from '@/devices/DeviceStream';
import { useEndpointId } from '@/state/keys';
import { deviceClientFor } from '@/transport/connections';
import { Button, ButtonGroup, Icon, IconButton, PanelEmpty, Menu } from '@basmilius/desktop-ui';

const GESTURES: ReadonlyArray<{ button: DeviceButton; icon: LucideIcon }> = [
    { button: 'swipeHome', icon: Hand },
    { button: 'appSwitcher', icon: Smartphone },
    { button: 'lock', icon: Lock },
    { button: 'siri', icon: Mic }
];

const ANDROID_LABELS: Partial<Record<DeviceButton, string>> = { appSwitcher: 'recentApps', lock: 'power', siri: 'assistant' };

const useDeviceFor = (reference: DeviceReference | undefined): { device: DeviceInfo | null; loading: boolean; error: string | null } => {
    const endpointId = useEndpointId();
    const row = useDeviceList(endpointId);
    const device = useResolvedDevice(endpointId, reference);
    useEffect(() => deviceClientFor(endpointId)?.watch(), [endpointId]);
    return { device, loading: row.loading, error: row.error };
};

export function DeviceControls({ device }: { device: DeviceInfo }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    if (device.state !== 'booted' || !device.capabilities.input) {
        return null;
    }
    const buttons = deviceButtons(device);
    const gestures = GESTURES.filter((gesture) => buttons.includes(gesture.button));
    const send = (command: DeviceInput): void => deviceClientFor(endpointId)?.input(device, command);
    const label = (button: DeviceButton): string => {
        const androidName = device.platform === 'android' ? ANDROID_LABELS[button] : undefined;
        return t(`device.controls.${androidName ?? button}`);
    };
    return (
        <ButtonGroup>
            {buttons.includes('back') && <IconButton icon={Undo2} label={label('back')} onClick={() => send({ kind: 'button', button: 'back' })} />}
            {buttons.includes('home') && <IconButton icon={House} label={label('home')} onClick={() => send({ kind: 'button', button: 'home' })} />}
            {gestures.length > 0 && (
                <Menu.Root>
                    <IconButton render={<Menu.Trigger />} icon={Hand} label={t('device.controls.gestures')} />
                    <Menu.Popup align="end">
                        {gestures.map((gesture) => (
                            <Menu.Item key={gesture.button} onClick={() => send({ kind: 'button', button: gesture.button })}>
                                <Icon icon={gesture.icon} size={14} /> {label(gesture.button)}
                            </Menu.Item>
                        ))}
                    </Menu.Popup>
                </Menu.Root>
            )}
            <Menu.Root>
                <IconButton render={<Menu.Trigger />} icon={RotateCw} label={t('device.controls.rotate')} />
                <Menu.Popup align="end">
                    <Menu.Item onClick={() => send({ kind: 'rotate', direction: 'left' })}>
                        <Icon icon={RotateCcw} size={14} /> {t('device.controls.rotateLeft')}
                    </Menu.Item>
                    <Menu.Item onClick={() => send({ kind: 'rotate', direction: 'right' })}>
                        <Icon icon={RotateCw} size={14} /> {t('device.controls.rotateRight')}
                    </Menu.Item>
                </Menu.Popup>
            </Menu.Root>
        </ButtonGroup>
    );
}

export function DeviceToolbar({ id }: { id: string }) {
    const reference = useNodeHost(id)?.device;
    const { device } = useDeviceFor(reference);
    return device ? <DeviceControls device={device} /> : null;
}

export function DeviceSurface({ device }: { device: DeviceInfo }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const [changing, setChanging] = useState(false);
    if (device.state !== 'booted') {
        const canBoot = device.capabilities.boot && device.state === 'shutdown';
        return (
            <DeviceMessage
                icon={Smartphone}
                message={t(`device.state.${device.state}`, { name: device.name })}
                action={
                    canBoot ? (
                        <Button
                            variant="primary"
                            size="sm"
                            disabled={changing}
                            onClick={() => {
                                setChanging(true);
                                void deviceClientFor(endpointId)
                                    ?.boot(device)
                                    .finally(() => setChanging(false));
                            }}
                        >
                            {changing && <Icon icon={LoaderCircle} size={12} className="animate-spin" />} {t('device.boot')}
                        </Button>
                    ) : undefined
                }
            />
        );
    }
    if (!device.capabilities.stream) {
        return <DeviceMessage icon={CircleAlert} message={t('device.noStream')} />;
    }
    return <DeviceStream key={`${device.backendId}:${device.deviceId}`} device={device} />;
}

export function DeviceBody({ id }: { id: string }) {
    const { t } = useTranslation('machines');
    const reference = useNodeHost(id)?.device;
    const { device, loading, error } = useDeviceFor(reference);
    if (!reference) {
        return <DeviceMessage icon={CircleAlert} message={t('device.noReference')} />;
    }
    if (!device) {
        if (loading) {
            return <DeviceMessage icon={Smartphone} busy message={t('device.finding', { name: reference.name })} />;
        }
        return (
            <DeviceMessage
                icon={error ? CircleAlert : Smartphone}
                message={error ?? t('device.notInstalled', { name: reference.name, runtime: reference.runtime })}
            />
        );
    }
    return <DeviceSurface device={device} />;
}

export function DevicePlate({ id }: { id: string }) {
    const { t } = useTranslation('machines');
    const reference = useNodeHost(id)?.device;
    return (
        <div className="grid h-full place-items-center bg-surface-sunken px-6 text-center">
            <div className="flex flex-col items-center gap-2 text-text-muted">
                <Icon icon={Smartphone} size={28} className="text-text-faint" />
                <span className="text-xs">{reference ? `${reference.name} · ${reference.runtime}` : t('device.plate')}</span>
            </div>
        </div>
    );
}

function DeviceMessage({ icon, busy = false, message, action }: { icon: LucideIcon; busy?: boolean; message: string; action?: ReactNode }) {
    return (
        <PanelEmpty icon={icon} busy={busy} action={action} sunken fill="full">
            {message}
        </PanelEmpty>
    );
}
