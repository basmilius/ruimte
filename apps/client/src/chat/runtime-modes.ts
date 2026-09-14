import type { RuntimeMode } from '@ruimte/contracts';

/* The labels and hints for the runtime modes, shared by the composer's mode picker and the settings dialog. */
export const RUNTIME_MODES: Array<{ id: RuntimeMode; label: string; hint: string }> = [
    { id: 'supervised', label: 'Supervised', hint: 'Asks before commands and file changes' },
    { id: 'auto-accept-edits', label: 'Auto-accept edits', hint: 'File edits go through, commands still ask' },
    { id: 'auto', label: 'Auto', hint: 'The agent reviews routine actions itself' },
    { id: 'full-access', label: 'Full access', hint: 'Never asks for approval' }
];
