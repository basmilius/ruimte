import type { MenuContext } from '@/commands/menu-context';

const ZOOMABLE: readonly NonNullable<MenuContext['view']>[] = ['canvas', 'drawing', 'diagram'];

export function zoomable(context: MenuContext): boolean {
    return context.view !== null && ZOOMABLE.includes(context.view);
}

export function worktreeChat(context: MenuContext): boolean {
    return context.workspace && context.folder && !context.scratch;
}

export function desktop(context: MenuContext): boolean {
    return context.host === 'desktop';
}

export function onCanvas(context: MenuContext): boolean {
    return context.view === 'canvas';
}

export function severalCells(context: MenuContext): boolean {
    return context.cells > 1;
}

export function hosted(context: MenuContext): boolean {
    return context.tabs.hosted;
}
