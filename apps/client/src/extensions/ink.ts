// Where the perceived brightness of a color stops carrying white text.
const BRIGHT = 0.6;

export function inkOn(color: string): string {
    const channel = (at: number): number => Number.parseInt(color.slice(at, at + 2), 16) / 255;

    return 0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5) > BRIGHT ? 'black' : 'white';
}
