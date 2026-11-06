import { Copy, Gauge } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const MEASURE_COMMANDS = {
    // The measurements: `appCommands()` offers these in a dev build only, and no menu has them.
    'measure-scene': { key: 'measureScene', icon: Gauge, palette: true },
    'measure-scene-grid': { key: 'measureGrid', icon: Gauge, palette: true },
    'measure-scene-files': { key: 'measureFiles', icon: Gauge, palette: true },
    'measure-scene-chats': { key: 'measureChats', icon: Gauge, palette: true },
    'measure-scene-terminals': { key: 'measureTerminals', icon: Gauge, palette: true },
    'measure-copy': { key: 'measureCopy', icon: Copy, palette: true }
} satisfies Record<string, CommandSpec>;
