import type { DiagramDocument, DrawingDocument } from '@ruimte/contracts';
import { renderDiagram, renderDrawing } from '../../server/src/render/scenes.ts';

(globalThis as typeof globalThis & { ruimteRenderDocument: (kind: string, json: string) => string }).ruimteRenderDocument = (kind, json) => {
    if (kind === 'drawing') {
        return JSON.stringify(renderDrawing(JSON.parse(json) as DrawingDocument));
    }
    if (kind === 'diagram') {
        return JSON.stringify(renderDiagram(JSON.parse(json) as DiagramDocument));
    }
    throw new Error('Unsupported document kind');
};
