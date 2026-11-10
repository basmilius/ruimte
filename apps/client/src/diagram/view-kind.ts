import { DiagramViewKindBody } from '@/diagram/DiagramViewKindBody';
import { viewKind, viewOfKind } from '@/registry/view-kinds';

export const DIAGRAM_VIEW_KIND = viewKind({ id: 'diagram', owns: viewOfKind('diagram'), body: DiagramViewKindBody });
