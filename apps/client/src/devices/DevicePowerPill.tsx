import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeviceInfo } from '@ruimte/contracts';
import { powerKey, powerLook, useDevicePowers } from '@/devices/device-power';
import { deviceClientFor } from '@/transport/connections';
import { Icon, Pill, Tooltip } from '@adecore/ui';

/*
 * A phone's own battery in the header of its node or view. Nothing for a device without one of its
 * own, and nothing while the battery is unknown, since an empty pill gives a person nothing to do.
 */
export function DevicePowerPill({ endpointId, device, narrow = false }: { endpointId: string; device: DeviceInfo; narrow?: boolean }) {
    const { t } = useTranslation('machines');
    const physical = device.kind === 'physical';
    const { backendId, platform, deviceId } = device;
    const power = useDevicePowers((s) => s[powerKey(endpointId, device)] ?? null);
    useEffect(() => {
        if (!physical) {
            return undefined;
        }
        return deviceClientFor(endpointId)?.watchPower({ backendId, platform, deviceId });
    }, [endpointId, physical, backendId, platform, deviceId]);
    if (!physical || power === null) {
        return null;
    }
    const look = powerLook(power);
    return (
        <Tooltip label={narrow ? `${look.level} · ${look.tooltip}` : look.tooltip} name={narrow}>
            <Pill tone={look.tone} icon={<Icon icon={look.icon} size={12} />} className="tabular-nums">
                {!narrow && look.level}
                {!narrow && look.simulated && <span className="text-text-faint">{t('device.power.simulated')}</span>}
            </Pill>
        </Tooltip>
    );
}
