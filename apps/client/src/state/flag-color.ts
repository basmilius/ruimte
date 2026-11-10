import { isFlagColor, type NodeAccent } from '@ruimte/contracts';
import { storedText } from '@/state/stored-json';

const storedFlagColor = storedText('ruimte.flag-color');

const FIRST_FLAG_COLOR: NodeAccent = 'red';

/* The color the flag shortcut sets: the one this client picked last, which is its own and never the project's. */
export function lastFlagColor(): NodeAccent {
    const stored = storedFlagColor.read();
    return stored !== null && isFlagColor(stored) ? stored : FIRST_FLAG_COLOR;
}

export function rememberFlagColor(color: NodeAccent): void {
    // Storage that refuses keeps the color for nothing but the next flag; red is where it starts again.
    storedFlagColor.write(color);
}
