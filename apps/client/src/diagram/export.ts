import type { StoreApi } from 'zustand';
import { toSvg } from '@ruimte/diagram';
import { readCanvasBackground, readFontStacks, readPalette, readPaper } from '@/drawing/palette';
import type { DiagramState } from '@/state/diagram';
import { useProject } from '@/state/project';

type DiagramSource = Pick<StoreApi<DiagramState>, 'getState'>;

const PNG_SCALE = 2;

/* The diagram in the colors of the theme it is exported from, through the painter the daemon uses too. */
export const diagramSvg = (store: DiagramSource): string => {
    const { content, layout } = store.getState();
    return toSvg(content, { layout, palette: readPalette(), paper: readPaper(), background: readCanvasBackground(), font: readFontStacks().sans });
};

/* The SVG drawn onto a canvas: one painter for both formats, so a PNG never differs from the SVG. */
export const diagramPng = async (store: DiagramSource): Promise<Blob | null> => {
    const url = URL.createObjectURL(new Blob([diagramSvg(store)], { type: 'image/svg+xml' }));
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(image.naturalWidth * PNG_SCALE);
        canvas.height = Math.ceil(image.naturalHeight * PNG_SCALE);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
    } finally {
        URL.revokeObjectURL(url);
    }
};

/* Where the file of a diagram view sits, or null when no project is open. */
export const diagramJsonPath = (viewId: string): string | null => {
    const folder = useProject.getState().current?.folder ?? null;
    return folder === null ? null : `${folder}/.ruimte/diagrams/${encodeURIComponent(viewId)}.json`;
};
