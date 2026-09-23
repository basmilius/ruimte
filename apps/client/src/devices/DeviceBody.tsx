import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu } from '@base-ui-components/react/menu';
import { CircleAlert, Hand, House, LoaderCircle, Lock, Mic, RotateCcw, RotateCw, Smartphone, Undo2, type LucideIcon } from 'lucide-react';
import { deviceButtons, type DeviceButton, type DeviceInfo, type DeviceInput, type DeviceReference } from '@ruimte/contracts';
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
        <div className={BTN_GROUP}>
            {buttons.includes('back') && (
                <Tooltip label={label('back')} name>
                    <button className="icon-btn" onClick={() => send({ kind: 'button', button: 'back' })}>
                        <Icon icon={Undo2} size={16} />
                    </button>
                </Tooltip>
            )}
            {buttons.includes('home') && (
                <Tooltip label={label('home')} name>
                    <button className="icon-btn" onClick={() => send({ kind: 'button', button: 'home' })}>
                        <Icon icon={House} size={16} />
                    </button>
                </Tooltip>
            )}
            {gestures.length > 0 && (
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
                                {gestures.map((gesture) => (
                                    <Menu.Item key={gesture.button} className="menu-item" onClick={() => send({ kind: 'button', button: gesture.button })}>
                                        <Icon icon={gesture.icon} size={14} /> {label(gesture.button)}
                                    </Menu.Item>
                                ))}
                            </Menu.Popup>
                        </Menu.Positioner>
                    </Menu.Portal>
                </Menu.Root>
            )}
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
