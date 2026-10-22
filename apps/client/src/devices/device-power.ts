import i18next from 'i18next';
import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning, type LucideIcon } from 'lucide-react';
import { create } from 'zustand';
import type { DeviceInfo, DevicePower } from '@ruimte/contracts';
import { formatNumber } from '@adecore/ui/format';

/* Below this, off power, a phone is about to stop a test run. */
export const LOW_BATTERY_PERCENT = 20;

/* The last battery each phone said, by `powerKey`; null where it could not say. */
export const useDevicePowers = create<Record<string, DevicePower | null>>(() => ({}));

export function powerKey(endpointId: string, device: Pick<DeviceInfo, 'backendId' | 'deviceId'>): string {
    return `${endpointId}:${device.backendId}:${device.deviceId}`;
}

export interface PowerLook {
    icon: LucideIcon;
    tone: 'muted' | 'needsYou';
    level: string;
    simulated: boolean;
    tooltip: string;
}

function iconOf(power: DevicePower, low: boolean): LucideIcon {
    if (power.plugged) {
        return BatteryCharging;
    }
    if (low) {
        return BatteryWarning;
    }
    return power.level >= 70 ? BatteryFull : power.level >= 40 ? BatteryMedium : BatteryLow;
}

function sourceOf(power: DevicePower): string | null {
    const key = `machines:device.power.source.${power.source}`;
    return power.source !== undefined && i18next.exists(key) ? i18next.t(key) : null;
}

function tooltipOf(power: DevicePower, low: boolean, level: string): string {
    if (power.simulated) {
        return i18next.t('machines:device.power.simulatedTooltip', { level });
    }
    if (low) {
        return i18next.t('machines:device.power.low');
    }
    if (!power.plugged) {
        return i18next.t('machines:device.power.battery');
    }
    const source = sourceOf(power);
    const plugged = source === null ? i18next.t('machines:device.power.plugged') : i18next.t('machines:device.power.pluggedFrom', { source });
    const state = power.charging
        ? i18next.t('machines:device.power.charging')
        : power.level >= 100
          ? i18next.t('machines:device.power.full')
          : i18next.t('machines:device.power.notCharging');
    return `${plugged} · ${state}`;
}

/* A simulated level is what the app under test sees, not a phone that drains, so it never warns. */
export function powerLook(power: DevicePower): PowerLook {
    const simulated = power.simulated === true;
    const low = !simulated && !power.plugged && power.level < LOW_BATTERY_PERCENT;
    const level = `${formatNumber(power.level)}%`;
    return { icon: iconOf(power, low), tone: low ? 'needsYou' : 'muted', level, simulated, tooltip: tooltipOf(power, low, level) };
}
