export function resizedText(x: number, width: number, side: 'left' | 'right', delta: number): { x: number; maxWidth: number } {
    const maxWidth = Math.max(40, Math.round(width + (side === 'left' ? -delta : delta)));
    return { x: side === 'left' ? x + width - maxWidth : x, maxWidth };
}
