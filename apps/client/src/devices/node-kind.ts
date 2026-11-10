import { DeviceNodeBody, DeviceNodeToolbar, DeviceViewBody } from '@/devices/DeviceKindBodies';
import { DeviceOperatedStrip } from '@/devices/DeviceOperatedStrip';
import type { NodeKindDefinition } from '@/registry/node-kinds';
import { viewKind, viewOfKind } from '@/registry/view-kinds';

export const DEVICE_NODE_KIND: NodeKindDefinition = { id: 'device', body: DeviceNodeBody, toolbar: DeviceNodeToolbar, strip: DeviceOperatedStrip };

export const DEVICE_VIEW_KIND = viewKind({ id: 'device', owns: viewOfKind('device'), body: DeviceViewBody });
