import { RoutineBody } from '@/routines/RoutineKindBody';
import type { NodeKindDefinition } from '@/registry/node-kinds';

export const ROUTINE_NODE_KIND: NodeKindDefinition = { id: 'routine', body: RoutineBody, controls: 'row' };
