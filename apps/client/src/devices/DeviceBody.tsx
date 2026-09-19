import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { CircleAlert, Hand, House, LoaderCircle, Lock, Mic, RotateCcw, RotateCw, Smartphone, type LucideIcon } from 'lucide-react';
import type { DeviceInfo, DeviceInput, DeviceReference } from '@ruimte/contracts';
import { useNodeHost } from '@/nodes/node-host';
import { useDeviceList, useResolvedDevice } from '@/devices/state';
import { DeviceStream } from '@/devices/DeviceStream';
import { useEndpointId } from '@/state/keys';
import { deviceClientFor } from '@/transport/connections';
import { BTN_GROUP, MENU_LABEL } from '@/ui/classes';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { PanelEmpty } from '@/ui/PanelEmpty';

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
    const send = (command: DeviceInput): void => deviceClientFor(endpointId)?.input(device, command);
    return (
        <div className={BTN_GROUP}>
            <Tooltip label={t('device.controls.home')} name>
                <button className="icon-btn" onClick={() => send({ kind: 'button', button: 'home' })}>
                    <Icon icon={House} size={16} />
                </button>
            </Tooltip>
            <Menu.Root>
                <Tooltip label={t('device.controls.gestures')} name>
                    <Menu.Trigger className="icon-btn">
                        <Icon icon={Hand} size={16} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" sideOffset={6} align="end">
                        <Menu.Popup className="menu-popup">
                            <div className={MENU_LABEL}>{t('device.controls.gestures')}</div>
                            <Menu.Item className="menu-item" onClick={() => send({ kind: 'button', button: 'swipeHome' })}>
                                <Icon icon={Hand} size={14} /> {t('device.controls.swipeHome')}
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => send({ kind: 'button', button: 'appSwitcher' })}>
                                <Icon icon={Smartphone} size={14} /> {t('device.controls.appSwitcher')}
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => send({ kind: 'button', button: 'lock' })}>
                                <Icon icon={Lock} size={14} /> {t('device.controls.lock')}
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => send({ kind: 'button', button: 'siri' })}>
                                <Icon icon={Mic} size={14} /> {t('device.controls.siri')}
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
            <Menu.Root>
                <Tooltip label={t('device.controls.rotate')} name>
                    <Menu.Trigger className="icon-btn">
                        <Icon icon={RotateCw} size={16} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-(--z-popup)" sideOffset={6} align="end">
                        <Menu.Popup className="menu-popup">
                            <div className={MENU_LABEL}>{t('device.controls.rotate')}</div>
                            <Menu.Item className="menu-item" onClick={() => send({ kind: 'rotate', direction: 'left' })}>
                                <Icon icon={RotateCcw} size={14} /> {t('device.controls.rotateLeft')}
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => send({ kind: 'rotate', direction: 'right' })}>
                                <Icon icon={RotateCw} size={14} /> {t('device.controls.rotateRight')}
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>
        </div>
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
            return <DeviceMessage icon={LoaderCircle} spin message={t('device.finding', { name: reference.name })} />;
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

function DeviceMessage({ icon, spin = false, message, action }: { icon: LucideIcon; spin?: boolean; message: string; action?: ReactNode }) {
    return (
        <PanelEmpty icon={icon} iconSize={24} spin={spin} action={action} sunken fill="full">
            {message}
        </PanelEmpty>
    );
}
