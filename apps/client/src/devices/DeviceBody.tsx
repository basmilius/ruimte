import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CircleAlert,
    Download,
    Ellipsis,
    Eraser,
    FoldVertical,
    Hand,
    House,
    LoaderCircle,
    Lock,
    Mic,
    MemoryStick,
    Play,
    Power,
    RefreshCw,
    RotateCcw,
    RotateCw,
    SlidersHorizontal,
    Smartphone,
    Square,
    Undo2,
    Vibrate,
    Volume1,
    Volume2,
    type LucideIcon
} from 'lucide-react';
import {
    absoluteOf,
    deviceButtons,
    deviceTools,
    type DeviceButton,
    type DeviceFoldPose,
    type DeviceInfo,
    type DeviceInput,
    type DeviceReference
} from '@ruimte/contracts';
import { PATHS_DRAG_TYPE } from '@/canvas/drop';
import { useNodeHost } from '@/nodes/node-host';
import { restartDevice } from '@/devices/control';
import { stopRecording } from '@/devices/device-capture';
import { dropAction } from '@/devices/device-files';
import { ANDROID_BUTTONS } from '@/devices/operated';
import { useDeviceList, useDevices, useRecordingEnded, useRecordingSince, useResolvedDevice } from '@/devices/state';
import { DevicePowerPill } from '@/devices/DevicePowerPill';
import { DeviceStream } from '@/devices/DeviceStream';
import { failed } from '@/shell/surface-failure';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { deviceClientFor } from '@/transport/connections';
import { formatClockDuration } from '@adecore/ui/format';
import { Button, ButtonGroup, ErrorBoundary, Icon, IconButton, LazyBoundary, lazyNamed, PanelEmpty, Menu, Popover, useNow } from '@adecore/ui';

const DeviceToolsPanel = lazyNamed(() => import('@/devices/DeviceToolsPanel'), 'DeviceToolsPanel');

const GESTURES: ReadonlyArray<{ button: DeviceButton; icon: LucideIcon }> = [
    { button: 'swipeHome', icon: Hand },
    { button: 'appSwitcher', icon: Smartphone },
    { button: 'lock', icon: Lock },
    { button: 'siri', icon: Mic },
    { button: 'volumeUp', icon: Volume2 },
    { button: 'volumeDown', icon: Volume1 },
    { button: 'power', icon: Power },
    { button: 'playPause', icon: Play }
];

function useDeviceFor(reference: DeviceReference | undefined): { device: DeviceInfo | null; loading: boolean; error: string | null } {
    const endpointId = useEndpointId();
    const row = useDeviceList(endpointId);
    const device = useResolvedDevice(endpointId, reference);
    useEffect(() => deviceClientFor(endpointId)?.watch(), [endpointId]);
    return { device, loading: row.loading, error: row.error };
}

/* The buttons a running device has, and its tools beside them. */
export function DeviceControls({ device }: { device: DeviceInfo }) {
    if (device.state !== 'booted') {
        return null;
    }
    return (
        <ButtonGroup>
            {device.capabilities.input && <DeviceButtons device={device} />}
            {deviceTools(device).includes('fold') && <DeviceFoldMenu device={device} />}
            {deviceTools(device).length > 0 && <DeviceToolsFlyout device={device} />}
            <DeviceMoreMenu device={device} />
        </ButtonGroup>
    );
}

/* The poses of a foldable: Android's console knows closed and open alone. */
function DeviceFoldMenu({ device }: { device: DeviceInfo }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const poses: readonly DeviceFoldPose[] = device.platform === 'ios' ? ['closed', 'tent', 'tabletop', 'book', 'open'] : ['closed', 'open'];
    const fold = (value: DeviceFoldPose): void => {
        void deviceClientFor(endpointId)
            ?.action({ backendId: device.backendId, platform: device.platform, deviceId: device.deviceId, action: 'setFold', value })
            .catch((error: unknown) =>
                useToasts.getState().show({
                    kind: 'error',
                    title: t('device.fold.failed'),
                    description: error instanceof Error ? error.message : String(error)
                })
            );
    };
    return (
        <Menu.Root>
            <IconButton render={<Menu.Trigger />} icon={FoldVertical} label={t('device.fold.label')} />
            <Menu.Popup align="end">
                {poses.map((pose) => (
                    <Menu.Item key={pose} onClick={() => fold(pose)}>
                        {t(`device.fold.poses.${pose}`)}
                    </Menu.Item>
                ))}
            </Menu.Popup>
        </Menu.Root>
    );
}

/* What a person does to the device as a whole, which an agent never does. */
function DeviceMoreMenu({ device }: { device: DeviceInfo }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const [restarting, setRestarting] = useState(false);
    const tools = deviceTools(device);
    const canRestart = device.capabilities.boot && device.capabilities.shutdown;
    const canErase = tools.includes('erase');
    const canShake = tools.includes('shake');
    const canWarn = tools.includes('memoryWarning');
    if (!canRestart && !canErase && !canShake && !canWarn) {
        return null;
    }
    const restart = (): void => {
        setRestarting(true);
        void restartDevice(deviceClientFor(endpointId), device).finally(() => setRestarting(false));
    };
    const act = (action: 'shake' | 'memoryWarning'): void => {
        void deviceClientFor(endpointId)
            ?.action({ backendId: device.backendId, platform: device.platform, deviceId: device.deviceId, action })
            .catch((error: unknown) =>
                useToasts.getState().show({
                    kind: 'error',
                    title: t('device.tools.changeFailed'),
                    description: error instanceof Error ? error.message : String(error)
                })
            );
    };
    return (
        <Menu.Root>
            <IconButton render={<Menu.Trigger />} icon={Ellipsis} busy={restarting} label={t('device.more')} />
            <Menu.Popup align="end">
                {canRestart && (
                    <Menu.Item disabled={restarting} onClick={restart}>
                        <Icon icon={RefreshCw} size={14} /> {t('device.restart')}
                    </Menu.Item>
                )}
                {canShake && (
                    <Menu.Item onClick={() => act('shake')}>
                        <Icon icon={Vibrate} size={14} /> {t('device.shake')}
                    </Menu.Item>
                )}
                {canWarn && (
                    <Menu.Item onClick={() => act('memoryWarning')}>
                        <Icon icon={MemoryStick} size={14} /> {t('device.memoryWarning')}
                    </Menu.Item>
                )}
                {canErase && (canRestart || canShake || canWarn) && <Menu.Separator />}
                {canErase && (
                    <Menu.Item onClick={() => useDevices.getState().askErase({ endpointId, device })}>
                        <Icon icon={Eraser} size={14} /> {t('device.erase.open')}
                    </Menu.Item>
                )}
            </Menu.Popup>
        </Menu.Root>
    );
}

function DeviceButtons({ device }: { device: DeviceInfo }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const buttons = deviceButtons(device);
    const gestures = GESTURES.filter((gesture) => buttons.includes(gesture.button));
    const send = (command: DeviceInput): void => deviceClientFor(endpointId)?.input(device, command);
    const label = (button: DeviceButton): string => {
        const androidName = device.platform === 'android' ? ANDROID_BUTTONS[button] : undefined;
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

export function DeviceToolsFlyout({ device }: { device: DeviceInfo }) {
    const { t } = useTranslation('panels');
    const [open, setOpen] = useState(false);
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <IconButton icon={SlidersHorizontal} label={t('devices.tools')} render={<Popover.Trigger />} aria-pressed={open} />
            <Popover.Popup
                variant="plain"
                side="left"
                collisionPadding={16}
                className="h-[min(720px,calc(100dvh-32px))] w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-border bg-surface shadow-float outline-none"
            >
                <ErrorBoundary label={failed('deviceTools')} resetKeys={[device.deviceId]} compact className="h-full">
                    <LazyBoundary>
                        <DeviceToolsPanel device={device} onClose={() => setOpen(false)} />
                    </LazyBoundary>
                </ErrorBoundary>
            </Popover.Popup>
        </Popover.Root>
    );
}

/* Over the screen while a person records it, so the recording shows with the tools closed, and stops from there too. */
function DeviceRecordingBadge({ device }: { device: DeviceInfo }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const since = useRecordingSince(endpointId, device);
    const ended = useRecordingEnded(endpointId, device);
    const now = useNow(1_000, since !== null && !ended);
    const [stopping, setStopping] = useState(false);
    if (since === null) {
        return null;
    }
    const stop = (): void => {
        setStopping(true);
        void stopRecording(endpointId, device)
            .catch((error: unknown) =>
                useToasts.getState().show({
                    kind: 'error',
                    title: t('device.tools.capture.recordFailed'),
                    description: error instanceof Error ? error.message : String(error)
                })
            )
            .finally(() => setStopping(false));
    };
    return (
        <div
            className="absolute top-2 right-2 flex items-center gap-1.5 rounded-full border border-border bg-surface-raised py-0.5 pr-0.5 pl-2.5 text-xs text-text shadow-float"
            role="status"
            aria-label={
                ended ? t('device.tools.capture.endedLabel') : t('device.tools.capture.recording', { time: formatClockDuration(Math.max(0, now - since)) })
            }
        >
            <span className={ended ? 'size-2 rounded-full bg-text-muted' : 'size-2 rounded-full bg-status-error'} aria-hidden />
            {ended ? (
                <span>{t('device.tools.capture.ended')}</span>
            ) : (
                <span className="font-mono tabular-nums">{formatClockDuration(Math.max(0, now - since))}</span>
            )}
            <IconButton
                icon={ended ? Download : Square}
                size="sm"
                busy={stopping}
                disabled={stopping}
                label={ended ? t('device.tools.capture.saveVideo') : t('device.tools.capture.stop')}
                onClick={stop}
            />
        </div>
    );
}

export function DeviceToolbar({ id, narrow = false }: { id: string; narrow?: boolean }) {
    const endpointId = useEndpointId();
    const reference = useNodeHost(id)?.device;
    const { device } = useDeviceFor(reference);
    if (!device) {
        return null;
    }
    return (
        <>
            <DevicePowerPill endpointId={endpointId} device={device} narrow={narrow} />
            <DeviceControls device={device} />
        </>
    );
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
    return (
        <DeviceDropZone device={device}>
            <DeviceStream key={`${device.backendId}:${device.deviceId}`} device={device} />
            <DeviceRecordingBadge device={device} />
        </DeviceDropZone>
    );
}

/* The paths a drag out of Ruimte's own file tree carries, against the project folder; a file from the Finder has no path here. */
function draggedPaths(transfer: DataTransfer, folder: string): string[] {
    return transfer
        .getData(PATHS_DRAG_TYPE)
        .split(/\s+/)
        .filter((path) => path !== '')
        .map((path) => absoluteOf(folder, path));
}

/* Takes an app to install or pictures to add, dropped from the project's file tree. */
function DeviceDropZone({ device, children }: { device: DeviceInfo; children: ReactNode }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const folder = useProject((state) => state.current?.folder ?? null);
    const [over, setOver] = useState(false);
    const tools = deviceTools(device);
    const accepts = folder !== null && (tools.includes('installApp') || tools.includes('addMedia'));
    const fail = (description: string): void => {
        useToasts.getState().show({ kind: 'error', title: t('device.tools.files.dropFailed'), description });
    };
    const drop = (event: DragEvent<HTMLDivElement>): void => {
        setOver(false);
        if (!accepts || !event.dataTransfer.types.includes(PATHS_DRAG_TYPE)) {
            return;
        }
        event.preventDefault();
        const action = dropAction(device, draggedPaths(event.dataTransfer, folder));
        if (action === null) {
            fail(t('device.tools.files.notTaken'));
            return;
        }
        void deviceClientFor(endpointId)
            ?.action({ backendId: device.backendId, platform: device.platform, deviceId: device.deviceId, ...action })
            .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
    };
    return (
        <div
            className="relative h-full min-h-0 w-full"
            onDragOver={(event) => {
                if (accepts && event.dataTransfer.types.includes(PATHS_DRAG_TYPE)) {
                    event.preventDefault();
                    setOver(true);
                }
            }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
        >
            {children}
            {over && (
                <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border-2 border-dashed border-accent bg-bg/80 px-4 text-center text-sm text-text">
                    {t('device.tools.files.drop')}
                </div>
            )}
        </div>
    );
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
