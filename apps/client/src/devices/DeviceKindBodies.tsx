import { DeviceBody, DevicePlate, DeviceToolbar } from '@/devices/DeviceBody';
import type { NodeBodyProps, NodeHeaderProps } from '@/registry/node-kinds';

export function DeviceNodeBody({ id, live, renderBody }: NodeBodyProps) {
    return live && renderBody ? <DeviceBody id={id} /> : <DevicePlate id={id} />;
}

export function DeviceNodeToolbar({ id, narrow }: NodeHeaderProps) {
    return <DeviceToolbar id={id} narrow={narrow} />;
}
