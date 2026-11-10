import { Braces, Copy, Download, Frame } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const DIAGRAM_COMMANDS = {
    'diagram-copy-json': { key: 'diagramCopyJson', icon: Copy, palette: true, menu: { menu: 'kind', group: 'diagram-copy', order: 10 } },
    'diagram-copy-png': { key: 'diagramCopyPng', icon: Copy, palette: true, menu: { menu: 'kind', group: 'diagram-copy', order: 20 } },
    'diagram-copy-svg': { key: 'diagramCopySvg', icon: Copy, palette: true, menu: { menu: 'kind', group: 'diagram-copy', order: 30 } },
    'diagram-save-png': { key: 'diagramSavePng', icon: Download, palette: true, menu: { menu: 'kind', group: 'diagram-save', order: 10 } },
    'diagram-save-svg': { key: 'diagramSaveSvg', icon: Download, palette: true, menu: { menu: 'kind', group: 'diagram-save', order: 20 } },
    'diagram-open-json': {
        key: 'diagramOpenJson',
        icon: Braces,
        palette: true,
        menu: { menu: 'kind', group: 'diagram-save', order: 30, when: (context) => context.folder }
    },
    'diagram-show-on-canvas': { key: 'diagramOnCanvas', icon: Frame, palette: true, menu: { menu: 'kind', group: 'diagram-show', order: 10 } }
} satisfies Record<string, CommandSpec>;
