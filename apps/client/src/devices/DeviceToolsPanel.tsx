import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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

const TEXT_SIZES: readonly DeviceTextSize[] = ['small', 'default', 'large', 'extra-large'];

const COLOR_FILTERS: readonly DeviceColorFilter[] = ['none', 'grayscale', 'red-green', 'green-red', 'blue-yellow'];

const PERMISSIONS: readonly DevicePermission[] = [
    'camera',
    'microphone',
    'photos',
    'contacts',
    'calendar',
    'reminders',
    'location',
    'motion',
    'media-library',
    'faceid'
];

/* City names and their coordinates, which read the same in every language. */
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
    const { t } = useTranslation('machines');
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
                    setError(cause instanceof Error ? cause.message : t('device.tools.readFailed'));
                }
            });
        return () => {
            active = false;
        };
    }, [device, endpointId, t]);

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
            setError(cause instanceof Error ? cause.message : t('device.tools.changeFailed'));
        } finally {
            setPending(false);
        }
    };

    const disabled = pending || settings === null;
    return (
        <aside className="flex h-full min-h-0 w-full flex-col bg-surface">
            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                <span className="text-xs font-medium text-text">{t('device.tools.title')}</span>
                {pending && <Icon icon={LoaderCircle} size={14} className="animate-spin text-text-muted" />}
                <Tooltip label={t('device.tools.close')} name>
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
                        <Icon icon={LoaderCircle} size={14} className="animate-spin" /> {t('device.tools.loading')}
                    </div>
                )}
                <ToolSection title={t('device.tools.app.title')}>
                    <TextAction
                        placeholder={t('device.tools.app.urlPlaceholder')}
                        label={t('device.tools.app.open')}
                        disabled={disabled}
                        onSubmit={(url) => act({ action: 'openUrl', url })}
                    />
                    <TextAction
                        placeholder={t('device.tools.bundleId')}
                        label={t('device.tools.app.launch')}
                        disabled={disabled}
                        onSubmit={(appId) => act({ action: 'launchApp', appId })}
                    />
                    <TextAction
                        placeholder={t('device.tools.bundleId')}
                        label={t('device.tools.app.terminate')}
                        disabled={disabled}
                        onSubmit={(appId) => act({ action: 'terminateApp', appId })}
                    />
                </ToolSection>
                <ToolSection title={t('device.tools.display.title')}>
                    <ToolRow label={t('device.tools.display.appearance')}>
                        <Segmented
                            label={t('device.tools.display.appearance')}
                            value={settings?.appearance ?? 'light'}
                            options={[
                                { id: 'light', label: t('device.tools.display.light') },
                                { id: 'dark', label: t('device.tools.display.dark') }
                            ]}
                            disabled={disabled || settings?.appearance === undefined}
                            onChange={(value) => void act({ action: 'setAppearance', value })}
                        />
                    </ToolRow>
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
                    <ToolRow label={t('device.tools.display.liquidGlass')}>
                        <Segmented
                            label={t('device.tools.display.liquidGlass')}
                            value={settings?.liquidGlass ?? 'clear'}
                            options={[
                                { id: 'clear', label: t('device.tools.display.clear') },
                                { id: 'tinted', label: t('device.tools.display.tinted') }
                            ]}
                            disabled={disabled || settings?.liquidGlass === undefined}
                            onChange={(value) => void act({ action: 'setLiquidGlass', value })}
                        />
                    </ToolRow>
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
                    <SettingToggle
                        label={t('device.tools.display.reduceMotion')}
                        setting="reduceMotion"
                        value={settings?.reduceMotion}
                        disabled={disabled}
                        act={act}
                    />
                    <SettingToggle
                        label={t('device.tools.display.increaseContrast')}
                        setting="increaseContrast"
                        value={settings?.increaseContrast}
                        disabled={disabled}
                        act={act}
                    />
                    <SettingToggle
                        label={t('device.tools.display.reduceTransparency')}
                        setting="reduceTransparency"
                        value={settings?.reduceTransparency}
                        disabled={disabled}
                        act={act}
                    />
                    <SettingToggle
                        label={t('device.tools.display.showBorders')}
                        setting="showBorders"
                        value={settings?.showBorders}
                        disabled={disabled}
                        act={act}
                    />
                    <SettingToggle label={t('device.tools.display.voiceOver')} setting="voiceOver" value={settings?.voiceOver} disabled={disabled} act={act} />
                </ToolSection>
                <LocationTools disabled={disabled} act={act} />
                <PermissionTools disabled={disabled} act={act} />
                <ToolSection title={t('device.tools.push.title')}>
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
    const { t } = useTranslation('machines');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const parsed = { latitude: Number(latitude), longitude: Number(longitude) };
    const valid = latitude.trim() !== '' && longitude.trim() !== '' && Math.abs(parsed.latitude) <= 90 && Math.abs(parsed.longitude) <= 180;
    return (
        <ToolSection title={t('device.tools.location.title')}>
            <div className="flex gap-1.5">
                <input
                    className={`${FIELD} w-1/2`}
                    inputMode="decimal"
                    value={latitude}
                    disabled={disabled}
                    placeholder={t('device.tools.location.latitude')}
                    onChange={(event) => setLatitude(event.target.value)}
                />
                <input
                    className={`${FIELD} w-1/2`}
                    inputMode="decimal"
                    value={longitude}
                    disabled={disabled}
                    placeholder={t('device.tools.location.longitude')}
                    onChange={(event) => setLongitude(event.target.value)}
                />
            </div>
            <div className="flex flex-wrap gap-1.5">
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
            </div>
        </ToolSection>
    );
}

function PermissionTools({ disabled, act }: { disabled: boolean; act: (body: ActionBody) => Promise<void> }) {
    const { t } = useTranslation('machines');
    const [appId, setAppId] = useState('');
    const [permission, setPermission] = useState<DevicePermission>('camera');
    const decide = (decision: 'grant' | 'revoke' | 'reset'): void => {
        const resolved = appId.trim();
        if (resolved) {
            void act({ action: 'setPermission', appId: resolved, permission, decision });
        }
    };
    return (
        <ToolSection title={t('device.tools.permissions.title')}>
            <input
                className={FIELD}
                value={appId}
                disabled={disabled}
                placeholder={t('device.tools.bundleId')}
                onChange={(event) => setAppId(event.target.value)}
            />
            <div className="flex flex-wrap gap-1.5">
                <Select<DevicePermission>
                    label={t('device.tools.permissions.label')}
                    value={permission}
                    items={PERMISSIONS.map((value) => ({ value, label: t(`device.tools.permissions.kinds.${value}`) }))}
                    size="sm"
                    disabled={disabled}
                    onValueChange={setPermission}
                />
                <Button size="sm" variant="secondary" disabled={disabled || !appId.trim()} onClick={() => decide('grant')}>
                    {t('device.tools.permissions.grant')}
                </Button>
                <Button size="sm" variant="secondary" disabled={disabled || !appId.trim()} onClick={() => decide('revoke')}>
                    {t('device.tools.permissions.revoke')}
                </Button>
                <Button size="sm" disabled={disabled || !appId.trim()} onClick={() => decide('reset')}>
                    {t('device.tools.permissions.reset')}
                </Button>
            </div>
        </ToolSection>
    );
}

function PushAction({ disabled, act }: { disabled: boolean; act: (body: ActionBody) => Promise<void> }) {
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
            <input
                className={FIELD}
                value={appId}
                disabled={disabled}
                placeholder={t('device.tools.bundleId')}
                onChange={(event) => setAppId(event.target.value)}
            />
            <div className="flex gap-1.5">
                <input
                    className={`${FIELD} grow`}
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
