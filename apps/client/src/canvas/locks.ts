import type { Locks } from '@/state/canvas';

/* The four locks as the dock and the settings dialog list them, with the hint that says what each one stops. */
export const LOCK_ROWS: { key: keyof Locks; label: string; hint: string }[] = [
    { key: 'pan', label: 'Pan', hint: 'The map stops sliding' },
    { key: 'zoom', label: 'Zoom', hint: 'Wheel and pinch are ignored' },
    { key: 'move', label: 'Move nodes', hint: 'Nodes stay where they are' },
    { key: 'resize', label: 'Resize nodes', hint: 'Handles are hidden' }
];
