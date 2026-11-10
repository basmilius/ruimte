import type { NodeKindDefinition } from '@/registry/node-kinds';
import { RoutineBody } from '@/routines/RoutineKindBody';

export const ROUTINE_NODE_KIND: NodeKindDefinition = { id: 'routine', body: RoutineBody, controls: 'row' };
