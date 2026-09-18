import { useEffect, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import { Popover } from '@base-ui-components/react/popover';
import {
    ArrowLeft,
    ChevronRight,
    CircleAlert,
    ExternalLink,
    Frame,
    LoaderCircle,
    PictureInPicture2,
    Power,
    PowerOff,
    RefreshCw,
    SlidersHorizontal,
    Smartphone
} from 'lucide-react';
import { isCanvasView, type DeviceInfo, type DeviceReference } from '@ruimte/contracts';
import { DeviceControls, DeviceSurface } from '@/devices/DeviceBody';
import { DeviceToolsPanel } from '@/devices/DeviceToolsPanel';
import { PanelHeaderLeadingSlot, PanelHeaderSlot, PanelHeaderTitleHidden } from '@/shell/PanelHeaderSlot';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';
import { useServer } from '@/state/server';
import { deviceClientFor } from '@/transport/connections';
import { useEndpointConnection } from '@/transport/status';
import { EMPTY_DEVICE_LIST, useDevices } from '@/devices/state';
import { BTN_GROUP, MENU_LABEL } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { SignInMark } from '@/ui/SignInMark';
import { Tooltip } from '@/ui/Tooltip';

const referenceOf = (device: DeviceInfo): DeviceReference => ({ platform: device.platform, kind: device.kind, name: device.name, runtime: device.runtime });

const sameReference = (left: DeviceReference, right: DeviceReference): boolean =>
    left.platform === right.platform && left.kind === right.kind && left.name === right.name && left.runtime === right.runtime;

const stateText = (device: DeviceInfo): string => {
    if (device.kind === 'physical') {
        return device.state === 'booted' ? 'Paired' : device.state === 'shutdown' ? 'Unavailable' : 'Connecting';
    }
    return device.state === 'booted' ? 'Running' : device.state === 'shutdown' ? 'Stopped' : 'Changing state';
};

interface DeviceGroup {
    key: string;
    title: string;
    platform: DeviceInfo['platform'];
    kind: DeviceInfo['kind'];
    active: boolean;
    devices: DeviceInfo[];
}

const displayRuntime = (device: Pick<DeviceInfo, 'platform' | 'runtime'>): string =>
    device.platform === 'ios' ? device.runtime.replace(/^iOS\s+/i, '') : device.runtime;

const groupTitle = (device: DeviceInfo, active: boolean): string => {
    if (active) {
        return device.platform === 'ios' ? 'Running iOS Simulators' : 'Running Android Emulators';
    }
    if (device.kind === 'physical') {
        return device.platform === 'ios' ? 'iOS Devices' : 'Android Devices';
    }
    return device.platform === 'ios' ? 'iOS Simulators' : 'Android Emulators';
};

const groupDevices = (devices: DeviceInfo[]): DeviceGroup[] => {
    const groups = new Map<string, DeviceGroup>();
    for (const device of devices) {
        const active = device.kind === 'simulator' && device.state === 'booted';
        const key = `${active ? 'active' : 'available'}:${device.platform}:${device.kind}`;
        const group = groups.get(key) ?? {
            key,
            title: groupTitle(device, active),
            platform: device.platform,
            kind: device.kind,
            active,
            devices: []
        };
        group.devices.push(device);
        groups.set(key, group);
    }
    return [...groups.values()].sort((left, right) => Number(right.active) - Number(left.active));
};

const openDeviceView = (device: DeviceInfo): void => {
    const reference = referenceOf(device);
    const document = useDocument.getState();
    const existing = document.views.find((view) => view.kind === 'device' && sameReference(view.device, reference));
    if (existing) {
        document.setActiveView(existing.id);
        return;
    }
    document.addStandaloneView({ kind: 'device', name: device.name, device: reference });
};

const addDeviceToCanvas = (device: DeviceInfo): void => {
    const document = useDocument.getState();
    const target = document.views.find((view) => view.id === document.lastCanvasViewId && isCanvasView(view)) ?? document.views.find(isCanvasView);
    if (!target) {
        return;
    }
    const id = document.addStandaloneView({ kind: 'device', name: device.name, device: referenceOf(device) });
    document.putOnCanvas(id, target.id);
};

function DeviceRow({ device, onOpen }: { device: DeviceInfo; onOpen: (device: DeviceInfo) => void }) {
    const endpointId = useEndpointId();
    const [changing, setChanging] = useState<'boot' | 'shutdown' | null>(null);
    const canOpen = device.capabilities.stream;
    const control = (action: 'boot' | 'shutdown'): void => {
        const client = deviceClientFor(endpointId);
        if (!client) {
            return;
        }
        setChanging(action);
        void client[action](device).finally(() => setChanging(null));
    };
    return (
        <article className="flex min-w-0 items-center gap-3 px-3 py-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-surface-raised text-text-muted">
                <Icon icon={Smartphone} size={18} />
            </span>
            <div className="min-w-0 grow">
                <h3 className="truncate text-sm font-medium text-text">{device.name}</h3>
                <p className="mt-0.5 truncate text-xs text-text-muted">
                    {displayRuntime(device)} · {stateText(device)}
                </p>
            </div>
            <div className={BTN_GROUP}>
                {device.state === 'shutdown' && device.capabilities.boot && (
                    <Tooltip label={changing === 'boot' ? 'Starting simulator' : 'Start simulator'} name>
                        <button className="icon-btn h-7 w-7" disabled={changing !== null} onClick={() => control('boot')}>
                            <Icon icon={changing === 'boot' ? LoaderCircle : Power} size={14} className={changing === 'boot' ? 'animate-spin' : undefined} />
                        </button>
                    </Tooltip>
                )}
                {device.state === 'booted' && device.capabilities.shutdown && (
                    <Tooltip label="Shut down simulator" name>
                        <button className="icon-btn h-7 w-7" disabled={changing !== null} onClick={() => control('shutdown')}>
                            <Icon
                                icon={changing === 'shutdown' ? LoaderCircle : PowerOff}
                                size={14}
                                className={changing === 'shutdown' ? 'animate-spin' : undefined}
                            />
                        </button>
                    </Tooltip>
                )}
                {device.state === 'transitioning' && (
                    <span className="grid size-7 place-items-center text-text-muted">
                        <Icon icon={LoaderCircle} size={14} className="animate-spin" />
                    </span>
                )}
                {canOpen && (
                    <Tooltip label={device.kind === 'physical' ? 'Open read-only preview' : 'Open in device panel'} name>
                        <button className="icon-btn h-7 w-7" disabled={changing !== null} onClick={() => onOpen(device)}>
                            <Icon icon={ChevronRight} size={14} />
                        </button>
                    </Tooltip>
                )}
            </div>
        </article>
    );
}

function DeviceSection({ group, onOpen }: { group: DeviceGroup; onOpen: (device: DeviceInfo) => void }) {
    return (
        <section>
            <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-text-muted">
                {group.platform === 'ios' ? <SignInMark provider="apple" size={15} /> : <Icon icon={Smartphone} size={15} />}
                {group.title}
            </h2>
            <div className="min-w-0 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {group.devices.map((device) => (
                    <DeviceRow key={`${device.backendId}:${device.deviceId}`} device={device} onOpen={onOpen} />
                ))}
            </div>
        </section>
    );
}

function DeviceList({ devices, onOpen }: { devices: DeviceInfo[]; onOpen: (device: DeviceInfo) => void }) {
    return (
        <div className="flex flex-col gap-5">
            {groupDevices(devices).map((group) => (
                <DeviceSection key={group.key} group={group} onOpen={onOpen} />
            ))}
        </div>
    );
}

function DeviceDetailHeader({ device, onClose }: { device: DeviceInfo; onClose: () => void }) {
    return (
        <>
            <PanelHeaderTitleHidden />
            <PanelHeaderLeadingSlot>
                <Tooltip label="Back to devices" name>
                    <button className="icon-btn" onClick={onClose}>
                        <Icon icon={ArrowLeft} size={16} />
                    </button>
                </Tooltip>
            </PanelHeaderLeadingSlot>
            <PanelHeaderSlot>
                <span className="min-w-0 truncate text-xs text-text-muted">
                    {device.name} · {displayRuntime(device)}
                </span>
            </PanelHeaderSlot>
        </>
    );
}

function DevicePlacementMenu({ device }: { device: DeviceInfo }) {
    return (
        <Menu.Root>
            <Tooltip label="Open simulator elsewhere" name>
                <Menu.Trigger className="icon-btn">
                    <Icon icon={PictureInPicture2} size={16} />
                </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" sideOffset={6} align="end">
                    <Menu.Popup className="menu-popup">
                        <div className={MENU_LABEL}>Open simulator</div>
                        <Menu.Item className="menu-item" onClick={() => openDeviceView(device)}>
                            <Icon icon={ExternalLink} size={14} /> Open as view
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => addDeviceToCanvas(device)}>
                            <Icon icon={Frame} size={14} /> Add to canvas
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}

function DevicePanelToolbar({ device, onClose }: { device: DeviceInfo; onClose: () => void }) {
    const endpointId = useEndpointId();
    const [shuttingDown, setShuttingDown] = useState(false);
    const shutDown = (): void => {
        const client = deviceClientFor(endpointId);
        if (!client) {
            return;
        }
        setShuttingDown(true);
        void client
            .shutdown(device)
            .then(onClose)
            .catch(() => undefined)
            .finally(() => setShuttingDown(false));
    };
    return (
        <div className="flex h-12 shrink-0 items-center justify-center border-t border-border bg-surface px-2">
            <div className={BTN_GROUP}>
                <DeviceControls device={device} />
                <DeviceToolsFlyout device={device} />
                <DevicePlacementMenu device={device} />
                {device.state === 'booted' && device.capabilities.shutdown && (
                    <Tooltip label="Shut down simulator" name>
                        <button className="icon-btn" disabled={shuttingDown} onClick={shutDown}>
                            <Icon icon={shuttingDown ? LoaderCircle : Power} size={16} className={shuttingDown ? 'animate-spin' : undefined} />
                        </button>
                    </Tooltip>
                )}
            </div>
        </div>
    );
}

function DeviceToolsFlyout({ device }: { device: DeviceInfo }) {
    const [open, setOpen] = useState(false);
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Tooltip label="Simulator tools" name>
                <Popover.Trigger className="icon-btn" aria-pressed={open} disabled={device.kind !== 'simulator' || device.state !== 'booted'}>
                    <Icon icon={SlidersHorizontal} size={16} />
                </Popover.Trigger>
            </Tooltip>
            <Popover.Portal>
                <Popover.Positioner side="left" align="start" sideOffset={8} collisionPadding={16} className="z-(--z-popup)">
                    <Popover.Popup className="h-[min(720px,calc(100dvh-32px))] w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-border bg-surface shadow-float outline-none">
                        <DeviceToolsPanel device={device} onClose={() => setOpen(false)} />
                    </Popover.Popup>
                </Popover.Positioner>
            </Popover.Portal>
        </Popover.Root>
    );
}

function PanelEmpty({ header, icon, spin = false, children }: { header: ReactNode; icon: typeof Smartphone; spin?: boolean; children: string }) {
    return (
        <div className="grid min-h-0 grow place-items-center">
            {header}
            <EmptyState icon={<Icon icon={icon} size={20} className={spin ? 'animate-spin' : undefined} />}>{children}</EmptyState>
        </div>
    );
}

export function DevicesPanel() {
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const platform = useServer((state) => state.platform);
    const streamingAllowed = useServer((state) => state.streamingAllowed);
    const machineName = useEndpoints((state) => state.endpoints.find((entry) => entry.id === endpointId)?.label ?? 'This machine');
    const row = useDevices((state) => state.byEndpoint[endpointId] ?? EMPTY_DEVICE_LIST);
    const [selection, setSelection] = useState<{ endpointId: string; device: DeviceReference } | null>(null);
    const selectedDevice =
        selection?.endpointId === endpointId ? (row.devices.find((device) => sameReference(referenceOf(device), selection.device)) ?? null) : null;
    useEffect(() => {
        if (connection.status === 'open' && streamingAllowed !== false) {
            return deviceClientFor(endpointId)?.watch();
        }
    }, [connection.status, endpointId, streamingAllowed]);

    const listHeader = (
        <PanelHeaderSlot>
            <span className="min-w-0 truncate text-xs text-text-muted">{machineName}</span>
            <span className="grow" />
            <Tooltip label="Refresh devices" name>
                <button
                    className="icon-btn"
                    disabled={row.loading}
                    onClick={() =>
                        void deviceClientFor(endpointId)
                            ?.refresh()
                            .catch(() => undefined)
                    }
                >
                    <Icon icon={row.loading ? LoaderCircle : RefreshCw} size={14} className={row.loading ? 'animate-spin' : undefined} />
                </button>
            </Tooltip>
        </PanelHeaderSlot>
    );

    const closeDevice = (): void => setSelection(null);
    const detailHeader = selectedDevice ? <DeviceDetailHeader device={selectedDevice} onClose={closeDevice} /> : null;

    if (platform !== 'darwin') {
        return (
            <PanelEmpty header={listHeader} icon={Smartphone}>
                iOS simulators are available when this machine runs macOS.
            </PanelEmpty>
        );
    }
    if (streamingAllowed === false) {
        return (
            <PanelEmpty header={listHeader} icon={CircleAlert}>
                Browser and device streaming is disabled in this machine's settings.
            </PanelEmpty>
        );
    }
    if (connection.status !== 'open') {
        return (
            <PanelEmpty header={listHeader} icon={CircleAlert}>
                This machine is not answering.
            </PanelEmpty>
        );
    }
    if (row.loading && row.devices.length === 0) {
        return (
            <PanelEmpty header={listHeader} icon={LoaderCircle} spin>
                Finding simulators...
            </PanelEmpty>
        );
    }
    if (row.error && row.devices.length === 0) {
        return (
            <PanelEmpty header={listHeader} icon={CircleAlert}>
                {row.error}
            </PanelEmpty>
        );
    }
    if (row.devices.length === 0) {
        return (
            <PanelEmpty header={listHeader} icon={Smartphone}>
                No iOS simulators are installed in Xcode.
            </PanelEmpty>
        );
    }
    if (selectedDevice && detailHeader) {
        return (
            <div className="flex min-h-0 grow flex-col">
                {detailHeader}
                <div className="relative flex min-h-0 grow">
                    <div className="min-h-0 min-w-0 grow">
                        <DeviceSurface device={selectedDevice} />
                    </div>
                </div>
                <DevicePanelToolbar device={selectedDevice} onClose={closeDevice} />
            </div>
        );
    }
    return (
        <div className="flex min-h-0 grow flex-col">
            {listHeader}
            <div className="min-h-0 grow overflow-y-auto p-3">
                <DeviceList
                    devices={row.devices}
                    onOpen={(device) => {
                        setSelection({ endpointId, device: referenceOf(device) });
                    }}
                />
            </div>
        </div>
    );
}
