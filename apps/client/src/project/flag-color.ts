import { isFlagColor, type NodeAccent } from '@ruimte/contracts';

const FLAG_COLOR_KEY = 'ruimte.flag-color';

const FIRST_FLAG_COLOR: NodeAccent = 'red';

/* The color the flag shortcut sets: the one this client picked last, which is its own and never the project's. */
export const lastFlagColor = (): NodeAccent => {
    try {
        const stored = localStorage.getItem(FLAG_COLOR_KEY);
        return stored !== null && isFlagColor(stored) ? stored : FIRST_FLAG_COLOR;
    } catch {
        return FIRST_FLAG_COLOR;
    }
};

export const rememberFlagColor = (color: NodeAccent): void => {
    try {
        localStorage.setItem(FLAG_COLOR_KEY, color);
    } catch {
        // Storage that refuses keeps the color for nothing but the next flag; red is where it starts again.
    }
};
