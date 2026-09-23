import { describe, expect, test } from 'bun:test';
import { BROWSER_TEXT_MAX_CHARS } from '@ruimte/contracts';
import { renderPage } from './context-browser.ts';

describe('renderPage', () => {
    test('the address stands above the page, and a tail leaves it standing', () => {
        const page = renderPage('https://ruimte.app', 'One\nTwo\nThree', 2);
        expect(page).toBe('# Page: https://ruimte.app\n\nTwo\nThree');
    });

    test('a page without text says so rather than answering nothing', () => {
        expect(renderPage('https://ruimte.app', '')).toContain('no text in it');
    });

    test('a page that ran into the cap says it was cut, so its end is not read as the end', () => {
        const page = renderPage('https://ruimte.app', 'a'.repeat(BROWSER_TEXT_MAX_CHARS));
        expect(page).toContain(`first ${BROWSER_TEXT_MAX_CHARS} characters`);
    });
});
