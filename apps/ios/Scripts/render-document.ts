import { diagramScene } from '@adecore/diagram';
import { drawingScene } from '@adecore/drawing';
import type { DiagramDocument, DrawingDocument } from '@ruimte/contracts';

(globalThis as typeof globalThis & { ruimteRenderDocument: (kind: string, json: string) => string }).ruimteRenderDocument = (kind, json) => {
    if (kind === 'drawing') {
        return JSON.stringify(drawingScene(JSON.parse(json) as DrawingDocument));
    }
    if (kind === 'diagram') {
        return JSON.stringify(diagramScene(JSON.parse(json) as DiagramDocument));
    }
    throw new Error('Unsupported document kind');
};
