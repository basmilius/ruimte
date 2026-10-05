import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BaselineStatus } from './BaselineStatus';

describe('the Baseline status in a hover', () => {
    test('is a mark and a sentence, never an image', () => {
        const markup = renderToStaticMarkup(
            createElement(BaselineStatus, { baseline: { level: 'widely', text: 'Widely available across major browsers (Baseline since 2015)' } })
        );
        expect(markup).toContain('Widely available across major browsers (Baseline since 2015)');
        expect(markup).toContain('<svg');
        expect(markup).toContain('text-status-idle');
        expect(markup).not.toContain('<img');
    });

    test('colors each level on its own', () => {
        const colorOf = (level: 'newly' | 'limited') => renderToStaticMarkup(createElement(BaselineStatus, { baseline: { level, text: 'Status' } }));
        expect(colorOf('newly')).toContain('text-status-running');
        expect(colorOf('limited')).toContain('text-status-needs-you');
    });
});
