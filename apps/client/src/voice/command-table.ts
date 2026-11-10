import { Mic } from 'lucide-react';
import { type CommandSpec } from '@/commands/types';

export const VOICE_COMMANDS = {
    // The key presses and holds: the capture listener of the workspace runs it (`voice/workspace-keys.ts`).
    'voice-control': { key: 'voiceControl', icon: Mic, binds: 'workspace', palette: false, keyOnly: true }
} satisfies Record<string, CommandSpec>;
