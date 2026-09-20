import { GRID, snapToGrid, type Rect } from '@/canvas/math';

export interface ResizeModifiers {
    centered?: boolean;
    proportional?: boolean;
}

export function resizedRect(rect: Rect, edge: string, dx: number, dy: number, modifiers: ResizeModifiers = {}, minimum = { w: 240, h: 160 }): Rect {
    const horizontal = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0;
    const vertical = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0;
    const factor = modifiers.centered ? 2 : 1;
    const edgeX = rect.x + (horizontal === 1 ? rect.w : 0);
    const edgeY = rect.y + (vertical === 1 ? rect.h : 0);
    let width = rect.w + horizontal * (snapToGrid(edgeX + dx) - edgeX) * factor;
    let height = rect.h + vertical * (snapToGrid(edgeY + dy) - edgeY) * factor;

    if (modifiers.proportional) {
        const horizontalDriver = horizontal !== 0 && (vertical === 0 || Math.abs(dx / rect.w) >= Math.abs(dy / rect.h));
        // Derive the ratio before snapping both dimensions; the grid takes precedence over an exact ratio.
        const scale = Math.max(horizontalDriver ? width / rect.w : height / rect.h, minimum.w / rect.w, minimum.h / rect.h);
        width = rect.w * scale;
        height = rect.h * scale;
    } else {
        width = horizontal === 0 ? rect.w : Math.max(minimum.w, width);
        height = vertical === 0 ? rect.h : Math.max(minimum.h, height);
    }

    width = Math.max(Math.ceil(minimum.w / GRID) * GRID, snapToGrid(width));
    height = Math.max(Math.ceil(minimum.h / GRID) * GRID, snapToGrid(height));

    return {
        x: snapToGrid(modifiers.centered || horizontal === 0 ? rect.x + (rect.w - width) / 2 : horizontal === -1 ? rect.x + rect.w - width : rect.x),
        y: snapToGrid(modifiers.centered || vertical === 0 ? rect.y + (rect.h - height) / 2 : vertical === -1 ? rect.y + rect.h - height : rect.y),
        w: width,
        h: height
    };
}
