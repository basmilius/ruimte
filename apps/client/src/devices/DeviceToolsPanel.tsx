import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CircleAlert, LoaderCircle, X } from 'lucide-react';
import type { DeviceAction, DeviceColorFilter, DeviceInfo, DevicePermission, DeviceSettings, DeviceTextSize, DeviceToggleSetting } from '@ruimte/contracts';
import { useEndpointId } from '@/state/keys';
import { deviceClientFor } from '@/transport/connections';
import { Segmented, Toggle } from '@/shell/settings/controls';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';

type ActionBody = DeviceAction extends infer Action ? (Action extends DeviceAction ? Omit<Action, 'backendId' | 'platform' | 'deviceId'> : never) : never;

const TEXT_SIZES: Array<{ value: DeviceTextSize; label: string }> = [
    { value: 'small', label: 'Small' },
    { value: 'default', label: 'Default' },
    { value: 'large', label: 'Large' },
    { value: 'extra-large', label: 'Extra large' }
];

const COLOR_FILTERS: Array<{ value: DeviceColorFilter; label: string }> = [
    { value: 'none', label: 'None' },
    { value: 'grayscale', label: 'Grayscale' },
    { value: 'red-green', label: 'Red / green' },
    { value: 'green-red', label: 'Green / red' },
    { value: 'blue-yellow', label: 'Blue / yellow' }
];

const PERMISSIONS: Array<{ value: DevicePermission; label: string }> = [
    { value: 'camera', label: 'Camera' },
    { value: 'microphone', label: 'Microphone' },
    { value: 'photos', label: 'Photos' },
    { value: 'contacts', label: 'Contacts' },
    { value: 'calendar', label: 'Calendar' },
    { value: 'reminders', label: 'Reminders' },
    { value: 'location', label: 'Location' },
    { value: 'motion', label: 'Motion' },
    { value: 'media-library', label: 'Media library' },
    { value: 'faceid', label: 'Face ID' }
];

const LOCATIONS = [
    { label: 'San Francisco', latitude: 37.7749, longitude: -122.4194 },
    { label: 'New York', latitude: 40.7128, longitude: -74.006 },
    { label: 'London', latitude: 51.5074, longitude: -0.1278 },
    { label: 'Amsterdam', latitude: 52.3676, longitude: 4.9041 },
    { label: 'Tokyo', latitude: 35.6762, longitude: 139.6503 }
] as const;

const FIELD =
    'h-8 min-w-0 rounded-lg border border-border bg-surface-raised px-2 text-xs text-text outline-none placeholder:text-text-faint focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50';

export function DeviceToolsPanel({ device, onClose }: { device: DeviceInfo; onClose: () => void }) {
    const endpointId = useEndpointId();
    const [settings, setSettings] = useState<DeviceSettings | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        void deviceClientFor(endpointId)
            ?.detail(device)
            .then((detail) => {
                if (active) {
                    setSettings(detail.settings);
                }
            })
            .catch((cause: unknown) => {
                if (active) {
                    setError(cause instanceof Error ? cause.message : 'The simulator settings could not be read');
                }
            });
        return () => {
            active = false;
        };
    }, [device, endpointId]);

    const act = async (body: ActionBody): Promise<void> => {
        const client = deviceClientFor(endpointId);
        if (!client) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            const detail = await client.action({ backendId: device.backendId, platform: device.platform, deviceId: device.deviceId, ...body } as DeviceAction);
            setSettings(detail.settings);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The simulator setting could not be changed');
        } finally {
            setPending(false);
        }
    };

    const disabled = pending || settings === null;
    return (
        <aside className="flex h-full min-h-0 w-full flex-col bg-surface">
            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                <span className="text-xs font-medium text-text">Simulator tools</span>
                {pending && <Icon icon={LoaderCircle} size={14} className="animate-spin text-text-muted" />}
                <Tooltip label="Close tools" name>
                    <button className="icon-btn ml-auto" onClick={onClose}>
                        <Icon icon={X} size={15} />
                    </button>
                </Tooltip>
            </header>
            <div className="min-h-0 grow overflow-y-auto">
                {error && (
                    <div className="flex items-start gap-2 border-b border-border bg-status-error/10 px-3 py-2 text-xs text-status-error" role="alert">
                        <Icon icon={CircleAlert} size={14} className="mt-0.5 shrink-0" /> {error}
                    </div>
                )}
                {settings === null && !error && (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-text-muted">
                        <Icon icon={LoaderCircle} size={14} className="animate-spin" /> Reading simulator settings…
                    </div>
                )}
                <ToolSection title="App">
                    <TextAction placeholder="https://… or myapp://" label="Open" disabled={disabled} onSubmit={(url) => act({ action: 'openUrl', url })} />
                    <TextAction placeholder="Bundle ID" label="Launch" disabled={disabled} onSubmit={(appId) => act({ action: 'launchApp', appId })} />
                    <TextAction placeholder="Bundle ID" label="Terminate" disabled={disabled} onSubmit={(appId) => act({ action: 'terminateApp', appId })} />
                </ToolSection>
                <ToolSection title="Display">
                    <ToolRow label="Appearance">
                        <Segmented
                            label="Appearance"
                            value={settings?.appearance ?? 'light'}
                            options={[
                                { id: 'light', label: 'Light' },
                                { id: 'dark', label: 'Dark' }
                            ]}
                            disabled={disabled || settings?.appearance === undefined}
                            onChange={(value) => void act({ action: 'setAppearance', value })}
                        />
                    </ToolRow>
                    <ToolRow label="Text size">
                        <Select
                            label="Text size"
                            value={settings?.textSize ?? null}
                            items={TEXT_SIZES}
                            size="sm"
                            align="end"
                            disabled={disabled || settings?.textSize === undefined}
                            onValueChange={(value) => void act({ action: 'setTextSize', value })}
                        />
                    </ToolRow>
                    <ToolRow label="Liquid Glass">
                        <Segmented
                            label="Liquid Glass"
                            value={settings?.liquidGlass ?? 'clear'}
                            options={[
                                { id: 'clear', label: 'Clear' },
                                { id: 'tinted', label: 'Tinted' }
                            ]}
                            disabled={disabled || settings?.liquidGlass === undefined}
                            onChange={(value) => void act({ action: 'setLiquidGlass', value })}
                        />
                    </ToolRow>
                    <ToolRow label="Color filter">
                        <Select
                            label="Color filter"
                            value={settings?.colorFilter ?? null}
                            items={COLOR_FILTERS}
                            size="sm"
                            align="end"
                            disabled={disabled || settings?.colorFilter === undefined}
                            onValueChange={(value) => void act({ action: 'setColorFilter', value })}
                        />
                    </ToolRow>
                    <SettingToggle label="Reduce Motion" setting="reduceMotion" value={settings?.reduceMotion} disabled={disabled} act={act} />
                    <SettingToggle label="Increase Contrast" setting="increaseContrast" value={settings?.increaseContrast} disabled={disabled} act={act} />
                    <SettingToggle
                        label="Reduce Transparency"
                        setting="reduceTransparency"
                        value={settings?.reduceTransparency}
                        disabled={disabled}
                        act={act}
                    />
                    <SettingToggle label="Show Borders" setting="showBorders" value={settings?.showBorders} disabled={disabled} act={act} />
                    <SettingToggle label="VoiceOver" setting="voiceOver" value={settings?.voiceOver} disabled={disabled} act={act} />
                </ToolSection>
                <LocationTools disabled={disabled} act={act} />
                <PermissionTools disabled={disabled} act={act} />
                <ToolSection title="Push notification">
                    <PushAction disabled={disabled} act={act} />
                </ToolSection>
            </div>
        </aside>
    );
}

function ToolSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-2.5 border-b border-border px-3 py-3 last:border-b-0">
            <h3 className="text-[11px] font-medium tracking-wide text-text-faint uppercase">{title}</h3>
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
    act: (body: ActionBody) => Promise<void>;
}) {
    return (
        <ToolRow label={label}>
            <Toggle
                checked={value ?? false}
                label={label}
                disabled={disabled || value === undefined}
                onChange={(next) => void act({ action: 'setToggle', setting, value: next })}
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
    onSubmit: (value: string) => Promise<void>;
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
            <input className={`${FIELD} grow`} value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} />
            <Button type="submit" size="sm" variant="secondary" disabled={disabled || value.trim().length === 0}>
                {label}
            </Button>
        </form>
    );
}

function LocationTools({ disabled, act }: { disabled: boolean; act: (body: ActionBody) => Promise<void> }) {
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const parsed = { latitude: Number(latitude), longitude: Number(longitude) };
    const valid = latitude.trim() !== '' && longitude.trim() !== '' && Math.abs(parsed.latitude) <= 90 && Math.abs(parsed.longitude) <= 180;
    return (
        <ToolSection title="Location">
            <div className="flex gap-1.5">
                <input
                    className={`${FIELD} w-1/2`}
                    inputMode="decimal"
                    value={latitude}
                    disabled={disabled}
                    placeholder="Latitude"
                    onChange={(event) => setLatitude(event.target.value)}
                />
                <input
                    className={`${FIELD} w-1/2`}
                    inputMode="decimal"
                    value={longitude}
                    disabled={disabled}
                    placeholder="Longitude"
                    onChange={(event) => setLongitude(event.target.value)}
                />
            </div>
            <div className="flex flex-wrap gap-1.5">
                <Select
                    label="Location preset"
                    value={null}
                    placeholder="Preset…"
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
                    Set
                </Button>
                <Button
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                        setLatitude('');
                        setLongitude('');
                        void act({ action: 'clearLocation' });
                    }}
                >
                    Clear
                </Button>
            </div>
        </ToolSection>
    );
}

function PermissionTools({ disabled, act }: { disabled: boolean; act: (body: ActionBody) => Promise<void> }) {
    const [appId, setAppId] = useState('');
    const [permission, setPermission] = useState<DevicePermission>('camera');
    const decide = (decision: 'grant' | 'revoke' | 'reset'): void => {
        const resolved = appId.trim();
        if (resolved) {
            void act({ action: 'setPermission', appId: resolved, permission, decision });
        }
    };
    return (
        <ToolSection title="Permissions">
            <input className={FIELD} value={appId} disabled={disabled} placeholder="Bundle ID" onChange={(event) => setAppId(event.target.value)} />
            <div className="flex flex-wrap gap-1.5">
                <Select<DevicePermission>
                    label="Permission"
                    value={permission}
                    items={PERMISSIONS}
                    size="sm"
                    disabled={disabled}
                    onValueChange={setPermission}
                />
                <Button size="sm" variant="secondary" disabled={disabled || !appId.trim()} onClick={() => decide('grant')}>
                    Grant
                </Button>
                <Button size="sm" variant="secondary" disabled={disabled || !appId.trim()} onClick={() => decide('revoke')}>
                    Revoke
                </Button>
                <Button size="sm" disabled={disabled || !appId.trim()} onClick={() => decide('reset')}>
                    Reset
                </Button>
            </div>
        </ToolSection>
    );
}

function PushAction({ disabled, act }: { disabled: boolean; act: (body: ActionBody) => Promise<void> }) {
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
            <input className={FIELD} value={appId} disabled={disabled} placeholder="Bundle ID" onChange={(event) => setAppId(event.target.value)} />
            <div className="flex gap-1.5">
                <input
                    className={`${FIELD} grow`}
                    value={payload}
                    disabled={disabled}
                    placeholder="Alert text"
                    onChange={(event) => setPayload(event.target.value)}
                />
                <Button type="submit" size="sm" variant="secondary" disabled={disabled || !appId.trim() || !payload.trim()}>
                    Send
                </Button>
            </div>
        </form>
    );
}
