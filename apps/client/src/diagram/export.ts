import type { StoreApi } from 'zustand';
import { toSvg } from '@ruimte/diagram';
import { download } from '@/drawing/export';
import { readCanvasBackground, readFontStacks, readPalette, readPaper } from '@/drawing/palette';
import type { DiagramState } from '@/state/diagram';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';

type DiagramSource = Pick<StoreApi<DiagramState>, 'getState'>;

const PNG_SCALE = 2;

const fileName = (extension: string): string => `diagram-${new Date().toISOString().slice(0, 10)}.${extension}`;

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

export const copyDiagramPng = async (store: DiagramSource): Promise<void> => {
    const blob = await diagramPng(store);
    if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }
};

export const saveDiagramPng = async (store: DiagramSource): Promise<void> => {
    const blob = await diagramPng(store);
    if (blob) {
        await download(blob, fileName('png'), 'image/png');
    }
};

export const copyDiagramSvg = async (store: DiagramSource): Promise<void> => {
    await navigator.clipboard.writeText(diagramSvg(store));
};

export const saveDiagramSvg = async (store: DiagramSource): Promise<void> => {
    await download(new Blob([diagramSvg(store)], { type: 'image/svg+xml' }), fileName('svg'), 'image/svg+xml');
};

/* The graph without its rev, which is what a person pastes into a chat to talk about it. */
export const copyDiagramJson = async (store: DiagramSource): Promise<void> => {
    await navigator.clipboard.writeText(`${JSON.stringify(store.getState().content, null, 2)}\n`);
};

/* Where the file of a diagram view sits, or null when no project is open. */
export const diagramJsonPath = (viewId: string): string | null => {
    const folder = useProject.getState().current?.folder ?? null;
    return folder === null ? null : `${folder}/.ruimte/diagrams/${encodeURIComponent(viewId)}.json`;
};

/* The file itself in the preview, which is where a person edits it by hand and the watcher takes it from there. */
export const openDiagramJson = (viewId: string): void => {
    const path = diagramJsonPath(viewId);
    if (path !== null) {
        useFiles.getState().open(path, useSettings.getState().filesTabLimit);
    }
};
