import { DrawingViewKindBody } from '@/drawing/DrawingViewKindBody';
import { viewKind, viewOfKind } from '@/registry/view-kinds';

export const DRAWING_VIEW_KIND = viewKind({ id: 'drawing', owns: viewOfKind('drawing'), body: DrawingViewKindBody });
