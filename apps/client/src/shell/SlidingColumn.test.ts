import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlidingColumn } from './SlidingColumn';

const renderColumn = (open: boolean, restoreWithProject?: boolean): string =>
    renderToStaticMarkup(
        createElement(
            SlidingColumn,
            {
                open,
                restoreWithProject,
                width: 380,
                bounds: { min: 320, max: () => 800 },
                onWidth: () => {}
            },
            'Voice Control'
        )
    );

describe('column animations during initial project restoration', () => {
    test('project panels suppress transitions while their saved layout is restored', () => {
        expect(renderColumn(true)).toContain('data-instant=""');
    });

    test('session-only panels keep transitions enabled in both open and closed states', () => {
        for (const open of [true, false]) {
            const markup = renderColumn(open, false);
            expect(markup).not.toContain('data-instant');
            expect(markup).toContain('panel-shell');
            expect(markup).toContain(`width:${open ? '380px' : '0'}`);
        }
    });
});
