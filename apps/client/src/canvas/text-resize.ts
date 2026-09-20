export function resizedText(x: number, width: number, side: 'left' | 'right', delta: number, centered = false): { x: number; maxWidth: number } {
    const maxWidth = Math.max(40, Math.round(width + (side === 'left' ? -delta : delta) * (centered ? 2 : 1)));
    return { x: centered ? x + (width - maxWidth) / 2 : side === 'left' ? x + width - maxWidth : x, maxWidth };
}
