import { injectVisualBootstrap } from '@ruimte/contracts';

/*
 * The page a preview renders lives on a made-up origin and is answered from memory, so it never
 * loads from a file and no request for it reaches a network. `.invalid` never resolves.
 */
export const PAGE_ORIGIN = 'https://visual.invalid';
export const PAGE_URL = `${PAGE_ORIGIN}/page.html`;

const ORIGIN_PATTERN = PAGE_ORIGIN.replaceAll('.', '\\.');
// The page's own address, with the line and column a stack frame or a console location puts after it.
const PAGE_LOCATION = new RegExp(`${ORIGIN_PATTERN}/page\\.html(?:[?#][^\\s:)]*)?(?::(\\d+))?(?::(\\d+))?`, 'g');
const OTHER_ON_ORIGIN = new RegExp(`${ORIGIN_PATTERN}/`, 'g');

function lineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
            starts.push(i + 1);
        }
    }
    return starts;
}

/*
 * The page as the browser gets it, with the bootstrap in front, and the way back from a place in
 * that to the same place in the page the agent wrote, whose lines the bootstrap would shift.
 */
export class PageSource {
    readonly html: string;
    readonly served: string;
    private readonly insertedAt: number;
    private readonly insertedLength: number;
    private readonly servedLines: number[];
    private readonly pageLines: number[];

    constructor(html: string) {
        this.html = html;
        this.served = injectVisualBootstrap(html);
        let common = 0;
        while (common < html.length && html.charCodeAt(common) === this.served.charCodeAt(common)) {
            common++;
        }
        // Any common start works: what follows the insertion in the served page is the rest of the page either way.
        this.insertedAt = common;
        this.insertedLength = this.served.length - html.length;
        this.servedLines = lineStarts(this.served);
        this.pageLines = lineStarts(html);
    }

    /* A 1-based line and column of the served page as they are in the page the agent wrote; null inside the bootstrap. */
    position(line: number, column: number): { line: number; column: number } | null {
        const start = this.servedLines[line - 1];
        if (start === undefined) {
            return null;
        }
        const servedOffset = start + Math.max(0, column - 1);
        let offset: number;
        if (servedOffset < this.insertedAt) {
            offset = servedOffset;
        } else if (servedOffset >= this.insertedAt + this.insertedLength) {
            offset = servedOffset - this.insertedLength;
        } else {
            return null;
        }
        let index = this.pageLines.length - 1;
        while (index > 0 && this.pageLines[index]! > offset) {
            index--;
        }
        return { line: index + 1, column: offset - this.pageLines[index]! + 1 };
    }

    /* A message with the page named `page.html` at the place the agent wrote, and anything else on its origin by the relative path it used. */
    describe(text: string): string {
        return text
            .replace(PAGE_LOCATION, (_match, line: string | undefined, column: string | undefined) => {
                if (line === undefined) {
                    return 'page.html';
                }
                const place = this.position(Number(line), column === undefined ? 1 : Number(column));
                if (place === null) {
                    return 'page.html';
                }
                return column === undefined ? `page.html:${place.line}` : `page.html:${place.line}:${place.column}`;
            })
            .replace(OTHER_ON_ORIGIN, '');
    }
}
