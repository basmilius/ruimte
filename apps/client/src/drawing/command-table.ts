import { Copy, Download, Frame } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const DRAWING_COMMANDS = {
    'drawing-copy-png': { key: 'drawingCopyPng', icon: Copy, palette: true, menu: { menu: 'kind', group: 'drawing-copy', order: 10 } },
    'drawing-copy-svg': { key: 'drawingCopySvg', icon: Copy, palette: true, menu: { menu: 'kind', group: 'drawing-copy', order: 20 } },
    'drawing-save-png': { key: 'drawingSavePng', icon: Download, palette: true, menu: { menu: 'kind', group: 'drawing-save', order: 10 } },
    'drawing-save-svg': { key: 'drawingSaveSvg', icon: Download, palette: true, menu: { menu: 'kind', group: 'drawing-save', order: 20 } },
    'drawing-show-on-canvas': { key: 'drawingOnCanvas', icon: Frame, palette: true, menu: { menu: 'kind', group: 'drawing-show', order: 10 } }
} satisfies Record<string, CommandSpec>;
