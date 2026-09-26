import { shortcut } from '@ruimte/ui/shortcut';

/* The shortcuts `use-drawing-keys.ts` binds, apart from the handler so the dock and the Keyboard pane print them. */
export const DRAWING_SHORTCUTS = {
    undo: shortcut('Mod+Z'),
    redo: shortcut('Mod+Shift+Z'),
    selectAll: shortcut('Mod+A'),
    duplicate: shortcut('Mod+D'),
    lock: shortcut('Mod+Shift+L'),
    copy: shortcut('Mod+C'),
    cut: shortcut('Mod+X'),
    paste: shortcut('Mod+V'),
    bringToFront: shortcut('Mod+]'),
    sendToBack: shortcut('Mod+['),
    zoomReset: shortcut('Mod+0'),
    fitAll: shortcut('Shift+1'),
    zoomSelection: shortcut('Shift+2')
} as const;
