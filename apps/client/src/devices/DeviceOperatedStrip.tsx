import { useEffect, useState, type RefObject } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import type { DeviceControlMode, DeviceInfo } from '@ruimte/contracts';
import { operatedOf, stripLook, tapPoint, useDeviceOperated, useOperatedDevice } from '@/devices/operated';
import { useResolvedDevice } from '@/devices/state';
import { useNodeHost } from '@/nodes/node-host';
import { useEndpointId } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { transportFor } from '@/transport';
import { Button } from '@/ui/Button';
import { Tooltip } from '@/ui/Tooltip';

/* How long the ring of a tap stays; with motion off it stands still for as long. */
const PING_MS = 700;

/* The fingertip the design gives a tap, round because on glass the middle is the point. */
function FingerMark() {
    return (
        <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden>
            <circle cx={12} cy={12} r={8} fill="currentColor" fillOpacity={0.5} stroke="currentColor" strokeWidth={2} />
        </svg>
    );
}

function press(endpointId: string, device: Pick<DeviceInfo, 'backendId' | 'deviceId'>, mode: DeviceControlMode): void {
    const link = transportFor(endpointId);
    if (!link) {
        return;
    }
    link.request('device.control', { backendId: device.backendId, deviceId: device.deviceId, mode })
        .then((operated) => useDeviceOperated.getState().receive(endpointId, operated))
        .catch((error: unknown) => {
            useToasts.getState().show({
                kind: 'error',
                title: i18next.t('machines:device.operated.failed'),
                description: error instanceof Error ? error.message : String(error)
            });
        });
}

/*
 * Under the header of a device node while an agent operates the device: what it does, and the buttons
 * that pause it or take the device over, which any client of the person may press.
 */
export function DeviceOperatedStrip({ id }: { id: string }) {
    const { t } = useTranslation('machines');
    const endpointId = useEndpointId();
    const device = useResolvedDevice(endpointId, useNodeHost(id)?.device);
    const operated = useOperatedDevice(endpointId, device);
    if (!device || !operated) {
        return null;
    }
    const look = stripLook(operated, device.platform);
    return (
        // One row with the header's own height and insets, so the two read as one toolbar.
        <div
            className="flex h-[39px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised pr-1 pl-2.5 text-xs"
            role="group"
            aria-label={t('device.operated.strip', { name: device.name })}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <Tooltip label={t('device.operated.label')} name>
                <span className={clsx('flex shrink-0 items-center', look.tone === 'accent' ? 'text-accent' : 'text-text-muted')}>
                    <FingerMark />
                </span>
            </Tooltip>
            <span className="min-w-0 grow truncate font-mono text-text-muted">{look.words}</span>
            <div className="flex shrink-0 items-center gap-1">
                {look.actions.map((mode) => (
                    <Button key={mode} size="sm" variant="secondary" onClick={() => press(endpointId, device, mode)}>
                        {t(`device.operated.${mode}`)}
                    </Button>
                ))}
            </div>
        </div>
    );
}

/* A ring where the agent tapped the screen, over the drawn stream; `screen` is the element the frame is drawn in. */
export function DeviceTapPing({ device, screen }: { device: DeviceInfo; screen: RefObject<HTMLElement | null> }) {
    const endpointId = useEndpointId();
    const [ping, setPing] = useState<{ seq: number; x: number; y: number } | null>(null);
    const { backendId, deviceId } = device;

    useEffect(() => {
        const target = { backendId, deviceId };
        // A tap from before this stream was drawn is not shown again.
        let seen = operatedOf(useDeviceOperated.getState(), endpointId, target)?.step?.seq ?? null;
        return useDeviceOperated.subscribe((state) => {
            const step = operatedOf(state, endpointId, target)?.step ?? null;
            const element = screen.current;
            if (!step || step.seq === seen || !element) {
                return;
            }
            seen = step.seq;
            const point = tapPoint(step, { left: element.offsetLeft, top: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight });
            if (point) {
                setPing({ seq: step.seq, ...point });
            }
        });
    }, [endpointId, backendId, deviceId, screen]);

    useEffect(() => {
        if (!ping) {
            return;
        }
        const timer = window.setTimeout(() => setPing(null), PING_MS);
        return () => window.clearTimeout(timer);
    }, [ping]);

    return ping ? <span key={ping.seq} className="device-tap-ping" style={{ left: ping.x, top: ping.y }} aria-hidden /> : null;
}
