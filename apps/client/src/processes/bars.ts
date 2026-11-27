export interface BarPart {
    key: string;
    /* The project's color; null for Ruimte itself, which is drawn in gray. */
    color: string | null;
    /* What it uses, in the unit of the bar. */
    value: number;
    /* Percent of the bar. */
    percent: number;
}

export interface Bar {
    parts: BarPart[];
    /* What the rest of the machine uses beyond the parts, in the unit of the bar. */
    restValue: number;
    /* Percent of the bar that rest takes. */
    rest: number;
}

/* The shares of one bar whose whole is `scale`. A sample can count a little more than the whole, so the parts are cut off at it. */
export function barOf(parts: readonly { key: string; color: string | null; value: number | null }[], machine: number | null, scale: number): Bar {
    let left = 100;
    let used = 0;
    const shares: BarPart[] = [];

    for (const part of parts) {
        if (part.value === null || part.value <= 0 || scale <= 0) {
            continue;
        }

        const percent = Math.min(left, (part.value / scale) * 100);
        left -= percent;
        used += part.value;
        shares.push({ key: part.key, color: part.color, value: part.value, percent });
    }

    const restValue = machine === null ? 0 : Math.max(0, machine - used);
    const rest = scale <= 0 ? 0 : Math.min(left, (restValue / scale) * 100);

    return { parts: shares, restValue, rest };
}
