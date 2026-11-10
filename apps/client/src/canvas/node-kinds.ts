import { DiagramBody, DrawingBody, FileBody, NoteBody, UnknownBody } from '@/canvas/NodeKindBodies';
import type { NodeKindDefinition } from '@/registry/node-kinds';

export const CANVAS_NODE_KINDS: readonly NodeKindDefinition[] = [
    { id: 'note', body: NoteBody },
    { id: 'drawing', body: DrawingBody },
    { id: 'diagram', body: DiagramBody },
    { id: 'file', body: FileBody, controls: 'buttons' },
    { id: 'unknown', body: UnknownBody }
];
