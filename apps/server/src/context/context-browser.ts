import { BROWSER_TEXT_MAX_CHARS } from '@ruimte/contracts';

/*
 * A browser as an agent reads it: the address, then the text of the page this machine has open. With
 * no page open it says so rather than fetching the address, which would be another visit and could
 * answer something else behind a login. A `tail` counts the page's lines and keeps the address.
 */
export function renderPage(url: string, text: string | null, tail: number | null = null, open: boolean = text !== null): string {
    if (url === '') {
        return ['# Page', '', 'This node has no address yet, so there is nothing to read. `ruimte-context browser go <id> --url <address>` gives it one.'].join(
            '\n'
        );
    }
    const heading = `# Page: ${url}`;
    if (text === null && open) {
        return [heading, '', 'The page is open, but it did not give its text; `ruimte-context browser shot <id>` shows what is on it.'].join('\n');
    }
    if (text === null) {
        return [heading, '', 'No page of this node is open on this machine, so its address is all that can be read here.'].join('\n');
    }
    if (text === '') {
        return [heading, '', 'This page has no text in it.'].join('\n');
    }
    const lines = text.split('\n');
    if (tail !== null) {
        return [heading, '', lines.slice(Math.max(0, lines.length - tail)).join('\n')].join('\n');
    }
    // A page that ran into the cap is cut off mid sentence; saying so keeps an agent from reading the end as the end.
    const cut = text.length >= BROWSER_TEXT_MAX_CHARS ? ['', `The page is longer than this: these are its first ${BROWSER_TEXT_MAX_CHARS} characters.`] : [];
    return [heading, '', text, ...cut].join('\n');
}
