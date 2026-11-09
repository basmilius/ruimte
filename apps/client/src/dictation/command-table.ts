import { Mic } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const DICTATION_COMMANDS = {
    // The key presses and holds: the capture listener of the workspace runs it (`dictation/workspace-keys.ts`).
    dictation: { key: 'dictation', icon: Mic, binds: 'workspace', palette: false, keyOnly: true }
} satisfies Record<string, CommandSpec>;
