import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCopy, ClipboardPaste, Copy, Download, Frame, ImagePlus, LoaderCircle, PackagePlus, Square, Video } from 'lucide-react';
import {
    devicePermissions,
    deviceTools,
    type DeviceAction,
    type DeviceColorFilter,
    type DeviceInfo,
    type DevicePermission,
    type DeviceSettings,
    type DeviceTextSize,
    type DeviceToggleSetting,
    type DeviceTool
} from '@ruimte/contracts';
import type { DeviceActionBody } from '@/devices/control';
import { copyScreenshot, placeScreenshotOnCanvas, saveScreenshot, startRecording, stopRecording } from '@/devices/device-capture';
import { isInstallable, isMedia } from '@/devices/device-files';
import { MachineFilePicker } from '@/devices/MachineFilePicker';
import { recordingKey, useDevices, useRecordingEnded, useRecordingSince } from '@/devices/state';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { deviceClientFor } from '@/transport/connections';
import { useMachineAnswers } from '@/transport/features';
import { formatClockDuration } from '@adecore/ui/format';
import {
    ScrollArea,
    Segmented,
    Switch,
    Button,
    ButtonGroup,
    CloseButton,
    FormError,
    Icon,
    IconButton,
    Input,
    PanelHeader,
    SectionLabel,
    Select,
    Slider,
    useNow,
    messageOf
} from '@adecore/ui';

/* Answers whether the device took the change. */
type Act = (body: DeviceActionBody) => Promise<boolean>;

const TEXT_SIZES: readonly DeviceTextSize[] = ['small', 'default', 'large', 'extra-large'];

const COLOR_FILTERS: readonly DeviceColorFilter[] = ['none', 'grayscale', 'red-green', 'green-red', 'blue-yellow'];

const TOGGLES: readonly DeviceToggleSetting[] = ['reduceMotion', 'increaseContrast', 'reduceTransparency', 'showBorders', 'voiceOver'];

const APP_TOOLS: readonly DeviceTool[] = ['openUrl', 'launchApp', 'terminateApp'];

const DISPLAY_TOOLS: readonly DeviceTool[] = ['appearance', 'textSize', 'liquidGlass', 'colorFilter', ...TOGGLES];

/* City names and their coordinates, which read the same in every language. */
const LOCATIONS = [
    { label: 'San Francisco', latitude: 37.7749, longitude: -122.4194 },
    { label: 'New York', latitude: 40.7128, longitude: -74.006 },
    { label: 'London', latitude: 51.5074, longitude: -0.1278 },
    { label: 'Amsterdam', latitude: 52.3676, longitude: 4.9041 },
    { label: 'Tokyo', latitude: 35.6762, longitude: 139.6503 }
] as const;

export function DeviceToolsPanel({ device, onClose }: { device: DeviceInfo; onClose: () => void }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const [settings, setSettings] = useState<DeviceSettings | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const answersCapture = useMachineAnswers(endpointId, 'device.capture');
    const answersRecord = useMachineAnswers(endpointId, 'device.record');
    const answersClipboard = useMachineAnswers(endpointId, 'device.clipboard');

    useEffect(() => {
        let active = true;
        void deviceClientFor(endpointId)
            ?.detail(device)
            .then((detail) => {
                if (active) {
                    setSettings(detail.settings);
                    noteRecording(endpointId, device, detail.settings);
                }
            })
            .catch((cause: unknown) => {
                if (active) {
                    setError(messageOf(cause, t('device.tools.readFailed')));
                }
            });
        return () => {
            active = false;
        };
    }, [device, endpointId, t]);

    /* A refusal is shown above the tools. */
    const act: Act = async (body) => {
        const client = deviceClientFor(endpointId);
        if (!client) {
            return false;
        }
        setPending(true);
        setError(null);
        try {
            const detail = await client.action({ backendId: device.backendId, platform: device.platform, deviceId: device.deviceId, ...body } as DeviceAction);
            setSettings(detail.settings);
            return true;
        } catch (cause) {
            setError(messageOf(cause, t('device.tools.changeFailed')));
            return false;
        } finally {
            setPending(false);
        }
    };

    const tools = deviceTools(device);
    const has = (tool: DeviceTool): boolean => tools.includes(tool);
    /* A tool a person reaches through a request of its own, which the machine has to name too. */
    const canCapture = has('capture') && answersCapture;
    const canRecord = has('record') && answersRecord;
    const canClipboard = has('clipboard') && answersClipboard;
    const appTools = APP_TOOLS.filter(has);
    const displayTools = DISPLAY_TOOLS.filter(has);
    const permissions = devicePermissions(device);
    const appIdPlaceholder = device.platform === 'android' ? t('device.tools.packageName') : t('device.tools.bundleId');
    const disabled = pending || settings === null;
    return (
        <aside className="flex h-full min-h-0 w-full flex-col bg-surface">
            <PanelHeader title={t('device.tools.title')}>
                {pending && <Icon icon={LoaderCircle} size={14} className="animate-spin text-text-muted" />}
                <CloseButton label={t('device.tools.close')} className="ml-auto" onClick={onClose} />
            </PanelHeader>
            <ScrollArea className="grow">
                {error && <FormError className="border-b border-border px-3 py-2 break-words">{error}</FormError>}
                {settings === null && !error && (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-muted">
                        <Icon icon={LoaderCircle} size={14} className="animate-spin" /> {t('device.tools.loading')}
                    </div>
                )}
                {(canCapture || canRecord) && <CaptureTools device={device} canCapture={canCapture} canRecord={canRecord} onError={setError} />}
                {canClipboard && <ClipboardTools device={device} onError={setError} />}
                {(appTools.length > 0 || has('installApp') || has('addMedia')) && (
                    <ToolSection title={t('device.tools.app.title')}>
                        {(has('installApp') || has('addMedia')) && (
                            <InstallTools device={device} canInstall={has('installApp')} canMedia={has('addMedia')} disabled={pending} act={act} />
                        )}
                        {has('openUrl') && (
                            <TextAction
                                placeholder={t('device.tools.app.urlPlaceholder')}
                                label={t('device.tools.app.open')}
                                disabled={disabled}
                                onSubmit={(url) => act({ action: 'openUrl', url })}
                            />
                        )}
                        {has('launchApp') && (
                            <TextAction
                                placeholder={appIdPlaceholder}
                                label={t('device.tools.app.launch')}
                                disabled={disabled}
                                onSubmit={(appId) => act({ action: 'launchApp', appId })}
                            />
                        )}
                        {has('terminateApp') && (
                            <TextAction
                                placeholder={appIdPlaceholder}
                                label={t('device.tools.app.terminate')}
                                disabled={disabled}
                                onSubmit={(appId) => act({ action: 'terminateApp', appId })}
                            />
                        )}
                    </ToolSection>
                )}
                {displayTools.length > 0 && (
                    <ToolSection title={t('device.tools.display.title')}>
                        {has('appearance') && (
                            <ToolRow label={t('device.tools.display.appearance')}>
                                <Segmented
                                    label={t('device.tools.display.appearance')}
                                    value={settings?.appearance ?? 'light'}
                                    options={[
                                        { id: 'light', label: t('device.tools.display.light') },
                                        { id: 'dark', label: t('device.tools.display.dark') }
                                    ]}
                                    disabled={disabled || settings?.appearance === undefined}
                                    onValueChange={(value) => void act({ action: 'setAppearance', value })}
                                />
                            </ToolRow>
                        )}
                        {has('textSize') && (
                            <ToolRow label={t('device.tools.display.textSize')}>
                                <Select
                                    label={t('device.tools.display.textSize')}
                                    value={settings?.textSize ?? null}
                                    items={TEXT_SIZES.map((size) => ({ value: size, label: t(`device.tools.textSizes.${size}`) }))}
                                    size="sm"
                                    align="end"
                                    disabled={disabled || settings?.textSize === undefined}
                                    onValueChange={(value) => void act({ action: 'setTextSize', value })}
                                />
                            </ToolRow>
                        )}
                        {has('liquidGlass') && (
                            <ToolRow label={t('device.tools.display.liquidGlass')}>
                                <Segmented
                                    label={t('device.tools.display.liquidGlass')}
                                    value={settings?.liquidGlass ?? 'clear'}
                                    options={[
                                        { id: 'clear', label: t('device.tools.display.clear') },
                                        { id: 'tinted', label: t('device.tools.display.tinted') }
                                    ]}
                                    disabled={disabled || settings?.liquidGlass === undefined}
                                    onValueChange={(value) => void act({ action: 'setLiquidGlass', value })}
                                />
                            </ToolRow>
                        )}
                        {has('colorFilter') && (
                            <ToolRow label={t('device.tools.display.colorFilter')}>
                                <Select
                                    label={t('device.tools.display.colorFilter')}
                                    value={settings?.colorFilter ?? null}
                                    items={COLOR_FILTERS.map((filter) => ({ value: filter, label: t(`device.tools.colorFilters.${filter}`) }))}
                                    size="sm"
                                    align="end"
                                    disabled={disabled || settings?.colorFilter === undefined}
                                    onValueChange={(value) => void act({ action: 'setColorFilter', value })}
                                />
                            </ToolRow>
                        )}
                        {TOGGLES.filter(has).map((setting) => (
                            <SettingToggle
                                key={setting}
                                label={t(`device.tools.display.${setting}`)}
                                setting={setting}
                                value={settings?.[setting]}
                                disabled={disabled}
                                act={act}
                            />
                        ))}
                    </ToolSection>
                )}
                {(has('location') || has('clearLocation')) && (
                    <LocationTools canSet={has('location')} canClear={has('clearLocation')} disabled={disabled} act={act} />
                )}
                {(has('statusBar') || has('battery')) && (
                    <StatusBarTools
                        device={device}
                        settings={settings}
                        canStatusBar={has('statusBar')}
                        canBattery={has('battery')}
                        disabled={disabled}
                        act={act}
                    />
                )}
                {has('biometrics') && <BiometricTools device={device} settings={settings} disabled={disabled} act={act} />}
                {has('fold') && <FoldTools device={device} settings={settings} disabled={disabled} act={act} />}
                {has('camera') && <CameraTools appIdPlaceholder={appIdPlaceholder} disabled={disabled} act={act} />}
                {has('permissions') && permissions.length > 0 && (
                    <PermissionTools permissions={permissions} appIdPlaceholder={appIdPlaceholder} disabled={disabled} act={act} />
                )}
                {has('push') && (
                    <ToolSection title={t('device.tools.push.title')}>
                        <PushAction appIdPlaceholder={appIdPlaceholder} disabled={disabled} act={act} />
                    </ToolSection>
                )}
            </ScrollArea>
        </aside>
    );
}

/*
 * A recording another client began, or one from before a reload, still shows; one that was stopped elsewhere
 * goes, and one that ended by itself shows as ended until its video is saved.
 */
function noteRecording(endpointId: string, device: DeviceInfo, { recording, recordingEnded }: DeviceSettings): void {
    const key = recordingKey(endpointId, device);
    const devices = useDevices.getState();
    const known = devices.recordings[key] !== undefined;
    if (recording === true && !known) {
        devices.markRecording(key, Date.now());
    } else if (recording === false && known) {
        devices.markRecording(key, null);
    }
    if (recording === true && recordingEnded === true) {
        useDevices.getState().markRecordingEnded(key);
    }
}

function CaptureTools({
    device,
    canCapture,
    canRecord,
    onError
}: {
    device: DeviceInfo;
    canCapture: boolean;
    canRecord: boolean;
    onError: (message: string | null) => void;
}) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const [busy, setBusy] = useState<'copy' | 'save' | 'place' | 'record' | null>(null);
    const since = useRecordingSince(endpointId, device);
    const ended = useRecordingEnded(endpointId, device);
    const now = useNow(1_000, since !== null && !ended);
    const run = (step: Exclude<typeof busy, null>, work: () => Promise<unknown>, failure: string): void => {
        setBusy(step);
        onError(null);
        void work()
            .catch((cause: unknown) => onError(messageOf(cause, failure)))
            .finally(() => setBusy(null));
    };
    const place = async (): Promise<void> => {
        if (!(await placeScreenshotOnCanvas(endpointId, device))) {
            onError(t('device.tools.capture.noCanvas'));
        }
    };
    return (
        <ToolSection title={t('device.tools.capture.title')}>
            {canCapture && (
                <ToolRow label={t('device.tools.capture.screenshot')}>
                    <ButtonGroup>
                        <IconButton
                            icon={Copy}
                            size="sm"
                            busy={busy === 'copy'}
                            disabled={busy !== null}
                            label={t('device.tools.capture.copy')}
                            onClick={() => run('copy', () => copyScreenshot(endpointId, device), t('device.tools.capture.failed'))}
                        />
                        <IconButton
                            icon={Download}
                            size="sm"
                            busy={busy === 'save'}
                            disabled={busy !== null}
                            label={t('device.tools.capture.save')}
                            onClick={() => run('save', () => saveScreenshot(endpointId, device), t('device.tools.capture.failed'))}
                        />
                        <IconButton
                            icon={Frame}
                            size="sm"
                            busy={busy === 'place'}
                            disabled={busy !== null}
                            label={t('device.tools.capture.place')}
                            onClick={() => run('place', place, t('device.tools.capture.failed'))}
                        />
                    </ButtonGroup>
                </ToolRow>
            )}
            {canRecord && (
                <>
                    <ToolRow label={t('device.tools.capture.record')}>
                        <div className="flex items-center gap-2">
                            {since !== null && !ended && (
                                <span className="font-mono text-xs text-text-muted tabular-nums">{formatClockDuration(Math.max(0, now - since))}</span>
                            )}
                            {ended && <span className="text-xs text-text-muted">{t('device.tools.capture.ended')}</span>}
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy !== null}
                                onClick={() =>
                                    run(
                                        'record',
                                        () => (since === null ? startRecording(endpointId, device) : stopRecording(endpointId, device)),
                                        t('device.tools.capture.recordFailed')
                                    )
                                }
                            >
                                {busy === 'record' ? (
                                    <Icon icon={LoaderCircle} size={12} className="animate-spin" />
                                ) : (
                                    <Icon icon={since === null ? Video : ended ? Download : Square} size={12} />
                                )}{' '}
                                {since === null
                                    ? t('device.tools.capture.start')
                                    : ended
                                      ? t('device.tools.capture.saveVideo')
                                      : t('device.tools.capture.stop')}
                            </Button>
                        </div>
                    </ToolRow>
                    {device.platform === 'android' && <p className="text-xs text-text-muted">{t('device.tools.capture.androidLimit')}</p>}
                </>
            )}
        </ToolSection>
    );
}

/*
 * The clipboard of the client a person sits at, not the machine's, so the same buttons work from
 * another machine or a browser.
 */
function ClipboardTools({ device, onError }: { device: DeviceInfo; onError: (message: string | null) => void }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const [busy, setBusy] = useState<'send' | 'copy' | null>(null);
    const run = (step: 'send' | 'copy', work: () => Promise<unknown>): void => {
        setBusy(step);
        onError(null);
        void work()
            .catch((cause: unknown) => onError(messageOf(cause, t('device.tools.clipboard.failed'))))
            .finally(() => setBusy(null));
    };
    const send = async (): Promise<void> => {
        const text = await navigator.clipboard.readText();
        await deviceClientFor(endpointId)?.clipboard(device, text);
    };
    const copy = async (): Promise<void> => {
        const text = await deviceClientFor(endpointId)?.clipboard(device);
        if (text !== undefined) {
            await navigator.clipboard.writeText(text);
        }
    };
    return (
        <ToolSection title={t('device.tools.clipboard.title')}>
            <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run('send', send)}>
                    <Icon icon={busy === 'send' ? LoaderCircle : ClipboardPaste} size={12} className={busy === 'send' ? 'animate-spin' : undefined} />{' '}
                    {t('device.tools.clipboard.send')}
                </Button>
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run('copy', copy)}>
                    <Icon icon={busy === 'copy' ? LoaderCircle : ClipboardCopy} size={12} className={busy === 'copy' ? 'animate-spin' : undefined} />{' '}
                    {t('device.tools.clipboard.copy')}
                </Button>
            </div>
        </ToolSection>
    );
}

/* How long a slider rests before its value is sent, so a drag sends one change and not every step. */
const SLIDER_SETTLE_MS = 250;

/* A slider's value while it moves, sent once it rests; null once the device answered. */
function useSettledSlider(send: (value: number) => Promise<unknown>): [number | null, (value: number) => void] {
    const [moving, setMoving] = useState<number | null>(null);
    const timer = useRef<number | null>(null);
    useEffect(
        () => () => {
            if (timer.current !== null) {
                window.clearTimeout(timer.current);
            }
        },
        []
    );
    const slide = (next: number): void => {
        setMoving(next);
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
        }
        timer.current = window.setTimeout(() => {
            timer.current = null;
            void send(next).finally(() => setMoving(null));
        }, SLIDER_SETTLE_MS);
    };
    return [moving, slide];
}

function StatusBarTools({
    device,
    settings,
    canStatusBar,
    canBattery,
    disabled,
    act
}: {
    device: DeviceInfo;
    settings: DeviceSettings | null;
    canStatusBar: boolean;
    canBattery: boolean;
    disabled: boolean;
    act: Act;
}) {
    const { t } = useTranslation('machines');
    const battery = settings?.battery;
    const charging = battery?.charging ?? false;
    const [level, slide] = useSettledSlider((next) => act({ action: 'setBattery', level: next, charging }));
    const shownLevel = level ?? battery?.level ?? 100;
    return (
        <ToolSection title={t('device.tools.statusBar.title')}>
            {canStatusBar && (
                <ToolRow label={t('device.tools.statusBar.style')}>
                    <Segmented
                        label={t('device.tools.statusBar.style')}
                        value={settings?.statusBar ?? 'default'}
                        options={[
                            { id: 'clean', label: t('device.tools.statusBar.clean') },
                            { id: 'default', label: t('device.tools.statusBar.default') }
                        ]}
                        disabled={disabled}
                        onValueChange={(value) => void act({ action: 'setStatusBar', value })}
                    />
                </ToolRow>
            )}
            {canBattery && (
                <>
                    <Slider
                        label={t('device.tools.statusBar.battery')}
                        value={shownLevel}
                        min={0}
                        max={100}
                        unit="%"
                        disabled={disabled}
                        onValueChange={slide}
                    />
                    <ToolRow label={t('device.tools.statusBar.charging')}>
                        <Switch
                            checked={charging}
                            label={t('device.tools.statusBar.charging')}
                            disabled={disabled}
                            onCheckedChange={(next) => void act({ action: 'setBattery', level: shownLevel, charging: next })}
                        />
                    </ToolRow>
                    <div className="flex items-center justify-between gap-3">
                        {device.platform === 'ios' && <p className="text-xs text-text-muted">{t('device.tools.statusBar.cosmetic')}</p>}
                        <Button size="sm" className="ml-auto" disabled={disabled} onClick={() => void act({ action: 'resetBattery' })}>
                            {t('device.tools.statusBar.reset')}
                        </Button>
                    </div>
                </>
            )}
        </ToolSection>
    );
}

/* The hinge as an angle, which only a simulator takes; an emulator folds through the node's fold menu alone. */
function FoldTools({ device, settings, disabled, act }: { device: DeviceInfo; settings: DeviceSettings | null; disabled: boolean; act: Act }) {
    const { t } = useTranslation('machines');
    const [degrees, slide] = useSettledSlider((next) => act({ action: 'setHinge', degrees: next }));
    const panel = settings?.panel;
    return (
        <ToolSection title={t('device.fold.title')}>
            {device.platform === 'ios' && (
                <Slider
                    label={t('device.fold.hinge')}
                    value={degrees ?? settings?.hinge ?? 180}
                    min={0}
                    max={180}
                    unit="°"
                    disabled={disabled}
                    onValueChange={slide}
                />
            )}
            {panel !== undefined && (
                <ToolRow label={t('device.fold.screen')}>
                    <span className="text-xs text-text">{t(`device.fold.panels.${panel}`)}</span>
                </ToolRow>
            )}
            {device.platform === 'android' && settings?.hinge !== undefined && (
                <ToolRow label={t('device.fold.hinge')}>
                    <span className="text-xs text-text">{t(settings.hinge === 0 ? 'device.fold.poses.closed' : 'device.fold.poses.open')}</span>
                </ToolRow>
            )}
        </ToolSection>
    );
}

function BiometricTools({ device, settings, disabled, act }: { device: DeviceInfo; settings: DeviceSettings | null; disabled: boolean; act: Act }) {
    const { t } = useTranslation('machines');
    // Android has a fingerprint to touch on an emulator only, and enrolls it in its own Settings.
    const sensors: ReadonlyArray<'face' | 'finger'> = device.platform === 'ios' ? ['face', 'finger'] : ['finger'];
    const sensorName = (sensor: 'face' | 'finger'): string =>
        sensor === 'face'
            ? t('device.tools.biometrics.face')
            : device.platform === 'ios'
              ? t('device.tools.biometrics.touch')
              : t('device.tools.biometrics.fingerprint');
    return (
        <ToolSection title={t('device.tools.biometrics.title')}>
            {device.platform === 'ios' && (
                <ToolRow label={t('device.tools.biometrics.enrolled')}>
                    <Switch
                        checked={settings?.biometricEnrolled ?? false}
                        label={t('device.tools.biometrics.enrolled')}
                        disabled={disabled}
                        onCheckedChange={(next) => void act({ action: 'biometric', sensor: 'face', event: next ? 'enroll' : 'unenroll' })}
                    />
                </ToolRow>
            )}
            {sensors.map((sensor) => (
                <ToolRow key={sensor} label={sensorName(sensor)}>
                    <div className="flex gap-1.5">
                        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => void act({ action: 'biometric', sensor, event: 'match' })}>
                            {t('device.tools.biometrics.match')}
                        </Button>
                        <Button size="sm" disabled={disabled} onClick={() => void act({ action: 'biometric', sensor, event: 'nomatch' })}>
                            {t('device.tools.biometrics.noMatch')}
                        </Button>
                    </div>
                </ToolRow>
            ))}
        </ToolSection>
    );
}

/* What one app sees through the simulator's camera: a test pattern or a picture or video from the machine. */
function CameraTools({ appIdPlaceholder, disabled, act }: { appIdPlaceholder: string; disabled: boolean; act: Act }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const folder = useProject((state) => state.current?.folder ?? null);
    const [appId, setAppId] = useState('');
    const [source, setSource] = useState<'off' | 'placeholder' | 'file'>('off');
    const [file, setFile] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const app = appId.trim();
    const choose = (next: 'off' | 'placeholder' | 'file'): void => {
        if (next === 'file') {
            setPicking(true);
            return;
        }
        void act({ action: 'setCamera', appId: app, source: next }).then((taken) => {
            if (taken) {
                setSource(next);
            }
        });
    };
    return (
        <ToolSection title={t('device.tools.camera.title')}>
            <Input
                size="sm"
                className="min-w-0 disabled:opacity-50"
                value={appId}
                disabled={disabled}
                placeholder={appIdPlaceholder}
                onChange={(event) => setAppId(event.target.value)}
            />
            <ToolRow label={t('device.tools.camera.source')}>
                <Segmented
                    label={t('device.tools.camera.source')}
                    value={source}
                    options={[
                        { id: 'off', label: t('device.tools.camera.sources.off') },
                        { id: 'placeholder', label: t('device.tools.camera.sources.placeholder') },
                        { id: 'file', label: t('device.tools.camera.sources.file') }
                    ]}
                    disabled={disabled || app.length === 0}
                    onValueChange={choose}
                />
            </ToolRow>
            {picking && (
                <MachineFilePicker
                    endpointId={endpointId}
                    start={folder ?? '/'}
                    pickable={isMedia}
                    multiple={false}
                    confirmLabel={t('device.tools.camera.pickFile')}
                    onPick={(paths) => {
                        setPicking(false);
                        const path = paths[0]!;
                        void act({ action: 'setCamera', appId: app, source: 'file', path }).then((taken) => {
                            if (taken) {
                                setSource('file');
                                setFile(path);
                            }
                        });
                    }}
                    onCancel={() => setPicking(false)}
                />
            )}
            {source === 'file' && file !== null && (
                <ToolRow label={t('device.tools.camera.file')}>
                    <span className="min-w-0 truncate text-xs text-text">{file.split('/').pop()}</span>
                </ToolRow>
            )}
            <p className="text-xs text-text-muted">{t('device.tools.camera.note')}</p>
        </ToolSection>
    );
}

/* An app or pictures from the machine the device runs on, picked there, so it works from another machine too. */
function InstallTools({
    device,
    canInstall,
    canMedia,
    disabled,
    act
}: {
    device: DeviceInfo;
    canInstall: boolean;
    canMedia: boolean;
    disabled: boolean;
    act: Act;
}) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const folder = useProject((state) => state.current?.folder ?? null);
    const [picking, setPicking] = useState<'app' | 'media' | null>(null);
    if (picking !== null) {
        return (
            <MachineFilePicker
                endpointId={endpointId}
                start={folder ?? '/'}
                pickable={picking === 'app' ? (path) => isInstallable(device, path) : isMedia}
                multiple={picking === 'media'}
                confirmLabel={t('device.tools.files.add')}
                onPick={(paths) => {
                    setPicking(null);
                    void act(picking === 'app' ? { action: 'installApp', path: paths[0]! } : { action: 'addMedia', paths });
                }}
                onCancel={() => setPicking(null)}
            />
        );
    }
    return (
        <div className="flex flex-wrap gap-1.5">
            {canInstall && (
                <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setPicking('app')}>
                    <Icon icon={PackagePlus} size={12} /> {t('device.tools.app.install')}
                </Button>
            )}
            {canMedia && (
                <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setPicking('media')}>
                    <Icon icon={ImagePlus} size={12} /> {t('device.tools.app.addMedia')}
                </Button>
            )}
        </div>
    );
}

function ToolSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-2.5 border-b border-border px-3 py-3 last:border-b-0">
            <SectionLabel render={<h3 />}>{title}</SectionLabel>
            {children}
        </section>
    );
}

function ToolRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-h-8 items-center justify-between gap-3">
            <span className="shrink-0 text-xs text-text-muted">{label}</span>
            <div className="flex min-w-0 justify-end">{children}</div>
        </div>
    );
}

function SettingToggle({
    label,
    setting,
    value,
    disabled,
    act
}: {
    label: string;
    setting: DeviceToggleSetting;
    value: boolean | undefined;
    disabled: boolean;
    act: Act;
}) {
    return (
        <ToolRow label={label}>
            <Switch
                checked={value ?? false}
                label={label}
                disabled={disabled || value === undefined}
                onCheckedChange={(next) => void act({ action: 'setToggle', setting, value: next })}
            />
        </ToolRow>
    );
}

function TextAction({
    placeholder,
    label,
    disabled,
    onSubmit
}: {
    placeholder: string;
    label: string;
    disabled: boolean;
    onSubmit: (value: string) => Promise<unknown>;
}) {
    const [value, setValue] = useState('');
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) {
            return;
        }
        void onSubmit(trimmed).then(() => setValue(''));
    };
    return (
        <form className="flex gap-1.5" onSubmit={submit}>
            <Input
                size="sm"
                className="min-w-0 grow disabled:opacity-50"
                value={value}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(event) => setValue(event.target.value)}
            />
            <Button type="submit" size="sm" variant="secondary" disabled={disabled || value.trim().length === 0}>
                {label}
            </Button>
        </form>
    );
}

function LocationTools({ canSet, canClear, disabled, act }: { canSet: boolean; canClear: boolean; disabled: boolean; act: Act }) {
    const { t } = useTranslation('machines');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const parsed = { latitude: Number(latitude), longitude: Number(longitude) };
    const valid = latitude.trim() !== '' && longitude.trim() !== '' && Math.abs(parsed.latitude) <= 90 && Math.abs(parsed.longitude) <= 180;
    return (
        <ToolSection title={t('device.tools.location.title')}>
            {canSet && (
                <div className="flex gap-1.5">
                    <Input
                        size="sm"
                        className="w-1/2 min-w-0 disabled:opacity-50"
                        inputMode="decimal"
                        value={latitude}
                        disabled={disabled}
                        placeholder={t('device.tools.location.latitude')}
                        onChange={(event) => setLatitude(event.target.value)}
                    />
                    <Input
                        size="sm"
                        className="w-1/2 min-w-0 disabled:opacity-50"
                        inputMode="decimal"
                        value={longitude}
                        disabled={disabled}
                        placeholder={t('device.tools.location.longitude')}
                        onChange={(event) => setLongitude(event.target.value)}
                    />
                </div>
            )}
            <div className="flex flex-wrap gap-1.5">
                {canSet && (
                    <>
                        <Select
                            label={t('device.tools.location.preset')}
                            value={null}
                            placeholder={t('device.tools.location.presetPlaceholder')}
                            items={LOCATIONS.map((location) => ({ value: location.label, label: location.label }))}
                            size="sm"
                            disabled={disabled}
                            onValueChange={(label) => {
                                const location = LOCATIONS.find((candidate) => candidate.label === label);
                                if (location) {
                                    setLatitude(String(location.latitude));
                                    setLongitude(String(location.longitude));
                                    void act({ action: 'setLocation', latitude: location.latitude, longitude: location.longitude });
                                }
                            }}
                        />
                        <Button size="sm" variant="secondary" disabled={disabled || !valid} onClick={() => void act({ action: 'setLocation', ...parsed })}>
                            {t('device.tools.location.set')}
                        </Button>
                    </>
                )}
                {canClear && (
                    <Button
                        size="sm"
                        disabled={disabled}
                        onClick={() => {
                            setLatitude('');
                            setLongitude('');
                            void act({ action: 'clearLocation' });
                        }}
                    >
                        {t('device.tools.location.clear')}
                    </Button>
                )}
            </div>
        </ToolSection>
    );
}

const DECISIONS = ['grant', 'revoke', 'reset'] as const;

function PermissionTools({
    permissions,
    appIdPlaceholder,
    disabled,
    act
}: {
    permissions: DevicePermission[];
    appIdPlaceholder: string;
    disabled: boolean;
    act: Act;
}) {
    const { t } = useTranslation('machines');
    const [appId, setAppId] = useState('');
    const [permission, setPermission] = useState<DevicePermission>(permissions[0]!);
    const app = appId.trim();
    const decide = (decision: (typeof DECISIONS)[number], all: boolean): void => {
        if (app) {
            void act(all ? { action: 'setAllPermissions', appId: app, decision } : { action: 'setPermission', appId: app, permission, decision });
        }
    };
    const row = (all: boolean): ReactNode => (
        <div className="flex flex-wrap gap-1.5">
            {!all && (
                <Select<DevicePermission>
                    label={t('device.tools.permissions.label')}
                    value={permission}
                    items={permissions.map((value) => ({ value, label: t(`device.tools.permissions.kinds.${value}`) }))}
                    size="sm"
                    disabled={disabled}
                    onValueChange={setPermission}
                />
            )}
            {DECISIONS.map((decision) => (
                <Button
                    key={decision}
                    size="sm"
                    variant={decision === 'reset' ? undefined : 'secondary'}
                    disabled={disabled || !app}
                    onClick={() => decide(decision, all)}
                >
                    {t(`device.tools.permissions.${decision}${all ? 'All' : ''}`)}
                </Button>
            ))}
        </div>
    );
    return (
        <ToolSection title={t('device.tools.permissions.title')}>
            <Input
                size="sm"
                className="min-w-0 disabled:opacity-50"
                value={appId}
                disabled={disabled}
                placeholder={appIdPlaceholder}
                onChange={(event) => setAppId(event.target.value)}
            />
            {row(false)}
            {row(true)}
        </ToolSection>
    );
}

function PushAction({ appIdPlaceholder, disabled, act }: { appIdPlaceholder: string; disabled: boolean; act: Act }) {
    const { t } = useTranslation('machines');
    const [appId, setAppId] = useState('');
    const [payload, setPayload] = useState('');
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        if (appId.trim() && payload.trim()) {
            void act({ action: 'sendPush', appId: appId.trim(), payload: payload.trim() }).then(() => setPayload(''));
        }
    };
    return (
        <form className="flex flex-col gap-1.5" onSubmit={submit}>
            <Input
                size="sm"
                className="min-w-0 disabled:opacity-50"
                value={appId}
                disabled={disabled}
                placeholder={appIdPlaceholder}
                onChange={(event) => setAppId(event.target.value)}
            />
            <div className="flex gap-1.5">
                <Input
                    size="sm"
                    className="min-w-0 grow disabled:opacity-50"
                    value={payload}
                    disabled={disabled}
                    placeholder={t('device.tools.push.alertText')}
                    onChange={(event) => setPayload(event.target.value)}
                />
                <Button type="submit" size="sm" variant="secondary" disabled={disabled || !appId.trim() || !payload.trim()}>
                    {t('device.tools.push.send')}
                </Button>
            </div>
        </form>
    );
}
