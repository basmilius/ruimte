import { DeviceOperatedStrip } from '@/devices/DeviceOperatedStrip';
import { DeviceNodeBody, DeviceNodeToolbar } from '@/devices/DeviceKindBodies';
import type { NodeKindDefinition } from '@/registry/node-kinds';

export const DEVICE_NODE_KIND: NodeKindDefinition = { id: 'device', body: DeviceNodeBody, toolbar: DeviceNodeToolbar, strip: DeviceOperatedStrip };
