import { BROWSER_TEXT_MAX_CHARS } from '../browser/manager.ts';

/*
 * A browser as an agent reads it: the address at the top, because that is where it starts, and what
 * the page says under it. The text is the page this machine has open, read the moment it is asked;
 * no page of it here is said plainly rather than fetched, since loading the address again would be
 * another visit and a page behind a login would answer something else entirely. A `tail` counts the
 * lines of the page and leaves the address standing, the way a drawing's tail leaves its picture out.
 */
export const renderPage = (url: string, text: string | null, tail: number | null = null): string => {
    if (url === '') {
        return ['# Page', '', 'This node has no address yet, so there is nothing to read. `ruimte-context browser go <id> --url <address>` gives it one.'].join(
            '\n'
        );
    }
    const heading = `# Page: ${url}`;
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
};
