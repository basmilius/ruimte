import { useEffect, useState } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
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
import { BTN_GROUP, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { SignInMark } from '@/ui/SignInMark';
import { Tooltip } from '@/ui/Tooltip';
import { PanelEmpty } from '@/ui/PanelEmpty';
import { MenuPopup } from '@/ui/MenuPopup';

const referenceOf = (device: DeviceInfo): DeviceReference => ({ platform: device.platform, kind: device.kind, name: device.name, runtime: device.runtime });

const sameReference = (left: DeviceReference, right: DeviceReference): boolean =>
    left.platform === right.platform && left.kind === right.kind && left.name === right.name && left.runtime === right.runtime;

const stateText = (device: DeviceInfo): string => {
    if (device.kind === 'physical') {
        return device.state === 'booted'
            ? i18next.t('panels:devices.state.paired')
            : device.state === 'shutdown'
              ? i18next.t('panels:devices.state.unavailable')
              : i18next.t('panels:devices.state.connecting');
    }
    return device.state === 'booted'
        ? i18next.t('panels:devices.state.running')
        : device.state === 'shutdown'
          ? i18next.t('panels:devices.state.stopped')
          : i18next.t('panels:devices.state.changing');
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
        return device.platform === 'ios' ? i18next.t('panels:devices.group.runningIos') : i18next.t('panels:devices.group.runningAndroid');
    }
    if (device.kind === 'physical') {
        return device.platform === 'ios' ? i18next.t('panels:devices.group.iosDevices') : i18next.t('panels:devices.group.androidDevices');
    }
    return device.platform === 'ios' ? i18next.t('panels:devices.group.iosSimulators') : i18next.t('panels:devices.group.androidEmulators');
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

/*
 * What a device row can be asked, shared by the right click on the row and the placement menu in
 * the panel's toolbar; `ContextMenu` draws a `Menu.Item` as its own.
 */
function DeviceMenuItems({ device, onOpen }: { device: DeviceInfo; onOpen?: (device: DeviceInfo) => void }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const control = (action: 'boot' | 'shutdown'): void => {
        void deviceClientFor(endpointId)?.[action](device);
    };
    return (
        <>
            {onOpen !== undefined && device.capabilities.stream && (
                <>
                    <Menu.Item className="menu-item" onClick={() => onOpen(device)}>
                        <Icon icon={ChevronRight} size={14} /> {device.kind === 'physical' ? t('devices.openPreview') : t('devices.openInPanel')}
                    </Menu.Item>
                    <Menu.Separator className={MENU_SEPARATOR} />
                </>
            )}
            <Menu.Item className="menu-item" onClick={() => openDeviceView(device)}>
                <Icon icon={ExternalLink} size={14} /> {t('devices.openAsView')}
            </Menu.Item>
            <Menu.Item className="menu-item" onClick={() => addDeviceToCanvas(device)}>
                <Icon icon={Frame} size={14} /> {t('devices.addToCanvas')}
            </Menu.Item>
            {device.state === 'shutdown' && device.capabilities.boot && (
                <>
                    <Menu.Separator className={MENU_SEPARATOR} />
                    <Menu.Item className="menu-item" onClick={() => control('boot')}>
                        <Icon icon={Power} size={14} /> {t('devices.start')}
                    </Menu.Item>
                </>
            )}
            {device.state === 'booted' && device.capabilities.shutdown && (
                <>
                    <Menu.Separator className={MENU_SEPARATOR} />
                    <Menu.Item className="menu-item" onClick={() => control('shutdown')}>
                        <Icon icon={PowerOff} size={14} /> {t('devices.shutdown')}
                    </Menu.Item>
                </>
            )}
        </>
    );
}

function DeviceRow({ device, onOpen }: { device: DeviceInfo; onOpen: (device: DeviceInfo) => void }) {
    const { t } = useTranslation('panels');
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
        <ContextMenu.Root>
            <ContextMenu.Trigger render={<article />} className="flex min-w-0 items-center gap-3 px-3 py-3">
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
                        <Tooltip label={changing === 'boot' ? t('devices.starting') : t('devices.start')} name>
                            <button className="icon-btn h-7 w-7" disabled={changing !== null} onClick={() => control('boot')}>
                                <Icon
                                    icon={changing === 'boot' ? LoaderCircle : Power}
                                    size={14}
                                    className={changing === 'boot' ? 'animate-spin' : undefined}
                                />
                            </button>
                        </Tooltip>
                    )}
                    {device.state === 'booted' && device.capabilities.shutdown && (
                        <Tooltip label={t('devices.shutdown')} name>
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
                        <Tooltip label={device.kind === 'physical' ? t('devices.openPreview') : t('devices.openInPanel')} name>
                            <button className="icon-btn h-7 w-7" disabled={changing !== null} onClick={() => onOpen(device)}>
                                <Icon icon={ChevronRight} size={14} />
                            </button>
                        </Tooltip>
                    )}
                </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
                <ContextMenu.Positioner className="z-(--z-popup)">
                    <ContextMenu.Popup className="menu-popup">
                        <DeviceMenuItems device={device} onOpen={onOpen} />
                    </ContextMenu.Popup>
                </ContextMenu.Positioner>
            </ContextMenu.Portal>
        </ContextMenu.Root>
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
    const { t } = useTranslation('panels');
    return (
        <>
            <PanelHeaderTitleHidden />
            <PanelHeaderLeadingSlot>
                <Tooltip label={t('devices.back')} name>
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
    const { t } = useTranslation('panels');
    return (
        <Menu.Root>
            <Tooltip label={t('devices.openElsewhere')} name>
                <Menu.Trigger className="icon-btn">
                    <Icon icon={PictureInPicture2} size={16} />
                </Menu.Trigger>
            </Tooltip>
            <MenuPopup align="end">
                <div className={MENU_LABEL}>{t('devices.openSimulator')}</div>
                <DeviceMenuItems device={device} />
            </MenuPopup>
        </Menu.Root>
    );
}

function DevicePanelToolbar({ device, onClose }: { device: DeviceInfo; onClose: () => void }) {
    const { t } = useTranslation('panels');
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
                    <Tooltip label={t('devices.shutdown')} name>
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
    const { t } = useTranslation('panels');
    const [open, setOpen] = useState(false);
    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Tooltip label={t('devices.tools')} name>
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

export function DevicesPanel() {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const connection = useEndpointConnection(endpointId);
    const platform = useServer((state) => state.platform);
    const streamingAllowed = useServer((state) => state.streamingAllowed);
    const machineName = useEndpoints((state) => state.endpoints.find((entry) => entry.id === endpointId)?.label ?? t('devices.thisMachine'));
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
            <Tooltip label={t('devices.refresh')} name>
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
                {t('devices.macOnly')}
            </PanelEmpty>
        );
    }
    if (streamingAllowed === false) {
        return (
            <PanelEmpty header={listHeader} icon={CircleAlert}>
                {t('devices.streamingOff')}
            </PanelEmpty>
        );
    }
    if (connection.status !== 'open') {
        return (
            <PanelEmpty header={listHeader} icon={CircleAlert}>
                {t('machineNotAnswering')}
            </PanelEmpty>
        );
    }
    if (row.loading && row.devices.length === 0) {
        return (
            <PanelEmpty header={listHeader} icon={LoaderCircle} spin>
                {t('devices.finding')}
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
                {t('devices.none')}
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
