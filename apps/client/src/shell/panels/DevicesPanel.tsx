import { ButtonGroup, Icon, IconButton, ListRow, PanelEmpty, Menu, ContextMenu, ScrollArea } from '@adecore/ui';
import type { DeviceInfo, DeviceReference } from '@ruimte/contracts';
import clsx from 'clsx';
import i18next from 'i18next';
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
    Smartphone
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createViewAction, placeViewOnCanvasAction } from '@/actions/client-actions';
import { AndroidMark } from '@/devices/AndroidMark';
import { controlDevice } from '@/devices/control';
import { deviceStateText, unavailableNotes } from '@/devices/device-text';
import { DeviceControls, DeviceSurface } from '@/devices/DeviceBody';
import { EMPTY_DEVICE_LIST, useDevices } from '@/devices/state';
import { PanelHeaderActions, PanelHeaderLeadingSlot, PanelHeaderSlot, PanelHeaderTitleHidden } from '@/shell/PanelHeaderSlot';
import { canvasInReach } from '@/state/canvas-target';
import { useEndpointId } from '@/state/current-endpoint';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { useServer } from '@/state/server';
import { deviceClientFor } from '@/transport/connections';
import { useEndpointConnection } from '@/transport/status';
import { SignInMark } from '@/ui/SignInMark';

function referenceOf({ platform, kind, name, runtime }: DeviceInfo): DeviceReference {
    return { platform, kind, name, runtime };
}

function sameReference(left: DeviceReference, right: DeviceReference): boolean {
    return left.platform === right.platform && left.kind === right.kind && left.name === right.name && left.runtime === right.runtime;
}

interface DeviceGroup {
    key: string;
    title: string;
    platform: DeviceInfo['platform'];
    kind: DeviceInfo['kind'];
    active: boolean;
    devices: DeviceInfo[];
}

function displayRuntime(device: Pick<DeviceInfo, 'platform' | 'runtime'>): string {
    return device.platform === 'ios' ? device.runtime.replace(/^iOS\s+/i, '') : device.runtime;
}

function groupTitle(device: DeviceInfo, active: boolean): string {
    if (active) {
        return device.platform === 'ios' ? i18next.t('panels:devices.group.runningIos') : i18next.t('panels:devices.group.runningAndroid');
    }
    if (device.kind === 'physical') {
        return device.platform === 'ios' ? i18next.t('panels:devices.group.iosDevices') : i18next.t('panels:devices.group.androidDevices');
    }
    return device.platform === 'ios' ? i18next.t('panels:devices.group.iosSimulators') : i18next.t('panels:devices.group.androidEmulators');
}

function groupDevices(devices: DeviceInfo[]): DeviceGroup[] {
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
}

function openDeviceView(device: DeviceInfo): void {
    const reference = referenceOf(device);
    const document = useDocument.getState();
    const existing = document.views.find((view) => view.kind === 'device' && sameReference(view.device, reference));
    if (existing) {
        document.setActiveView(existing.id);
        return;
    }
    void createViewAction('device', { device: reference });
}

async function addDeviceToCanvas(device: DeviceInfo): Promise<void> {
    // Chosen before the view is made, since the new view opens over the focused cell, a canvas there too.
    const target = canvasInReach(useDocument.getState());
    if (target === null) {
        return;
    }
    const id = await createViewAction('device', { device: referenceOf(device) });
    if (id !== null) {
        placeViewOnCanvasAction(id, target.id);
    }
}

/*
 * What a device row can be asked, shared by the right click on the row and the placement menu in
 * the panel's toolbar; `ContextMenu` draws a `Menu.Item` as its own.
 */
function DeviceMenuItems({ device, onOpen }: { device: DeviceInfo; onOpen?: (device: DeviceInfo) => void }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const control = (action: 'boot' | 'shutdown'): void => {
        void controlDevice(deviceClientFor(endpointId), device, action);
    };
    return (
        <>
            {onOpen !== undefined && device.capabilities.stream && (
                <>
                    <Menu.Item onClick={() => onOpen(device)}>
                        <Icon icon={ChevronRight} size={14} /> {device.capabilities.input ? t('devices.openInPanel') : t('devices.openPreview')}
                    </Menu.Item>
                    <Menu.Separator />
                </>
            )}
            <Menu.Item onClick={() => openDeviceView(device)}>
                <Icon icon={ExternalLink} size={14} /> {t('devices.openAsView')}
            </Menu.Item>
            <Menu.Item onClick={() => void addDeviceToCanvas(device)}>
                <Icon icon={Frame} size={14} /> {t('devices.addToCanvas')}
            </Menu.Item>
            {device.state === 'shutdown' && device.capabilities.boot && (
                <>
                    <Menu.Separator />
                    <Menu.Item onClick={() => control('boot')}>
                        <Icon icon={Power} size={14} /> {t('devices.start')}
                    </Menu.Item>
                </>
            )}
            {device.state === 'booted' && device.capabilities.shutdown && (
                <>
                    <Menu.Separator />
                    <Menu.Item onClick={() => control('shutdown')}>
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
    const canStart = device.state === 'shutdown' && device.capabilities.boot;
    const canShutDown = device.state === 'booted' && device.capabilities.shutdown;
    const hasActions = canOpen || canStart || canShutDown;
    const control = (action: 'boot' | 'shutdown'): void => {
        const client = deviceClientFor(endpointId);
        if (!client) {
            return;
        }
        setChanging(action);
        void controlDevice(client, device, action).finally(() => setChanging(null));
    };
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={<ListRow variant="inset" />}
                className="group relative min-w-0 gap-2 hover:bg-surface-hover focus-within:bg-surface-hover"
            >
                <span className="grid size-4 shrink-0 place-items-center">
                    {device.state === 'transitioning' || changing !== null ? (
                        <Icon icon={LoaderCircle} size={14} className="animate-spin text-text-muted" />
                    ) : (
                        <span className={clsx('size-1.5 rounded-full', device.state === 'booted' ? 'bg-positive' : 'border border-text-faint')} />
                    )}
                    <span className="sr-only">{deviceStateText(device)}</span>
                </span>
                {canOpen ? (
                    <button
                        type="button"
                        disabled={changing !== null}
                        onClick={() => onOpen(device)}
                        className="min-w-0 grow truncate text-left text-sm text-text before:absolute before:inset-0 before:rounded-md focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-accent"
                    >
                        {device.name}
                    </button>
                ) : (
                    <span className="min-w-0 grow truncate text-sm text-text">{device.name}</span>
                )}
                {device.reason !== undefined ? (
                    <span className="min-w-0 shrink truncate text-xs text-text-muted">{deviceStateText(device)}</span>
                ) : (
                    <span className={clsx('shrink-0 text-xs text-text-faint tabular-nums', hasActions && 'group-hover:hidden group-focus-within:hidden')}>
                        {displayRuntime(device)}
                    </span>
                )}
                {/* Out of the flow instead of `hidden` while the row is at rest, so the keyboard still reaches a button on a row that has nothing else to focus. */}
                <span className="pointer-events-none absolute right-2 flex shrink-0 items-center gap-0.5 opacity-0 group-hover:pointer-events-auto group-hover:relative group-hover:right-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:relative group-focus-within:right-0 group-focus-within:opacity-100">
                    {canStart && (
                        <IconButton
                            icon={Power}
                            size="sm"
                            label={changing === 'boot' ? t('devices.starting') : t('devices.start')}
                            disabled={changing !== null}
                            onClick={() => control('boot')}
                        />
                    )}
                    {canShutDown && (
                        <IconButton icon={PowerOff} size="sm" label={t('devices.shutdown')} disabled={changing !== null} onClick={() => control('shutdown')} />
                    )}
                    {canOpen && (
                        <span className="pointer-events-none grid size-6 place-items-center text-text-muted">
                            <Icon icon={ChevronRight} size={14} />
                        </span>
                    )}
                </span>
            </ContextMenu.Trigger>
            <ContextMenu.Popup>
                <DeviceMenuItems device={device} onOpen={onOpen} />
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

function DeviceSection({
    group,
    collapsed,
    onCollapse,
    onOpen
}: {
    group: DeviceGroup;
    collapsed: boolean;
    onCollapse: (collapsed: boolean) => void;
    onOpen: (device: DeviceInfo) => void;
}) {
    return (
        <section>
            <h2 className={clsx('-mx-1 flex', !collapsed && 'mb-0.5')}>
                <ListRow
                    variant="inset"
                    render={<button type="button" />}
                    aria-expanded={!collapsed}
                    onClick={() => onCollapse(!collapsed)}
                    className={`group w-full min-w-0 gap-2 text-left text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-accent`}
                >
                    <span className="grid size-4 shrink-0 place-items-center">
                        <span className="col-start-1 row-start-1 grid place-items-center group-hover:hidden group-focus-visible:hidden">
                            {group.platform === 'ios' ? <SignInMark provider="apple" size={14} /> : <AndroidMark size={14} />}
                        </span>
                        <Icon
                            icon={ChevronRight}
                            size={14}
                            className={clsx('col-start-1 row-start-1 hidden group-hover:block group-focus-visible:block', !collapsed && 'rotate-90')}
                        />
                    </span>
                    <span className="truncate">{group.title}</span>
                </ListRow>
            </h2>
            {!collapsed && (
                <div className="-mx-1 flex min-w-0 flex-col">
                    {group.devices.map((device) => (
                        <DeviceRow key={`${device.backendId}:${device.deviceId}`} device={device} onOpen={onOpen} />
                    ))}
                </div>
            )}
        </section>
    );
}

function DeviceList({
    devices,
    collapsed,
    onCollapse,
    onOpen
}: {
    devices: DeviceInfo[];
    collapsed: readonly string[];
    onCollapse: (key: string, collapsed: boolean) => void;
    onOpen: (device: DeviceInfo) => void;
}) {
    return (
        <div className="flex flex-col gap-3">
            {groupDevices(devices).map((group) => (
                <DeviceSection
                    key={group.key}
                    group={group}
                    collapsed={collapsed.includes(group.key)}
                    onCollapse={(next) => onCollapse(group.key, next)}
                    onOpen={onOpen}
                />
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
                <IconButton icon={ArrowLeft} label={t('devices.back')} onClick={onClose} />
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
            <IconButton icon={PictureInPicture2} label={t('devices.openElsewhere')} render={<Menu.Trigger />} />
            <Menu.Popup align="end">
                <DeviceMenuItems device={device} />
            </Menu.Popup>
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
        void controlDevice(client, device, 'shutdown')
            .then((done) => {
                if (done) {
                    onClose();
                }
            })
            .finally(() => setShuttingDown(false));
    };
    return (
        <div className="flex h-12 shrink-0 items-center justify-center border-t border-border bg-surface px-2">
            <ButtonGroup>
                <DeviceControls device={device} />
                <DevicePlacementMenu device={device} />
                {device.state === 'booted' && device.capabilities.shutdown && (
                    <IconButton icon={Power} busy={shuttingDown} label={t('devices.shutdown')} disabled={shuttingDown} onClick={shutDown} />
                )}
            </ButtonGroup>
        </div>
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
    const collapsedGroups = useDevices((state) => state.collapsedGroups);
    const selectedDevice =
        selection?.endpointId === endpointId ? (row.devices.find((device) => sameReference(referenceOf(device), selection.device)) ?? null) : null;
    useEffect(
        () => (connection.status === 'open' && streamingAllowed ? deviceClientFor(endpointId)?.watch() : undefined),
        [connection.status, endpointId, streamingAllowed]
    );

    const listHeader = (
        <PanelHeaderSlot>
            <span className="min-w-0 truncate text-xs text-text-muted">{machineName}</span>
            <PanelHeaderActions>
                <IconButton
                    icon={RefreshCw}
                    busy={row.loading}
                    label={t('devices.refresh')}
                    disabled={row.loading}
                    onClick={() =>
                        void deviceClientFor(endpointId)
                            ?.refresh()
                            .catch(() => undefined)
                    }
                />
            </PanelHeaderActions>
        </PanelHeaderSlot>
    );

    const notes = unavailableNotes(row.unavailable, platform);
    const closeDevice = (): void => setSelection(null);
    const detailHeader = selectedDevice ? <DeviceDetailHeader device={selectedDevice} onClose={closeDevice} /> : null;

    if (!streamingAllowed) {
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
            <PanelEmpty header={listHeader} busy>
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
                {notes.map((note) => (
                    <span key={note} className="mt-2 block">
                        {note}
                    </span>
                ))}
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
            <ScrollArea className="grow" viewportClassName="p-3">
                <DeviceList
                    devices={row.devices}
                    collapsed={collapsedGroups}
                    onCollapse={(key, collapsed) => useDevices.getState().collapseGroup(key, collapsed)}
                    onOpen={(device) => setSelection({ endpointId, device: referenceOf(device) })}
                />
                {row.unavailable.length > 0 && (
                    <p className="mt-5 px-1 text-xs text-text-muted">
                        {notes.map((note) => (
                            <span key={note} className="block">
                                {note}
                            </span>
                        ))}
                    </p>
                )}
            </ScrollArea>
        </div>
    );
}
