import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeldCommand } from './LaunchControls';

describe('a launch that waits on approval', () => {
    test('shows the variables it would run with above its folder and command', () => {
        const markup = renderToStaticMarkup(
            createElement(HeldCommand, {
                held: { launchId: 'dev', command: 'bun dev', cwd: '/work/app', env: { PATH: './shim:/usr/bin', NODE_OPTIONS: '--require ./hook.js' } }
            })
        );
        expect(markup).toContain('PATH=</span>./shim:/usr/bin');
        expect(markup).toContain('NODE_OPTIONS=</span>--require ./hook.js');
        expect(markup.indexOf('NODE_OPTIONS')).toBeLessThan(markup.indexOf('/work/app $ '));
        expect(markup).toContain('bun dev');
    });

    test('one without variables is its folder and command alone', () => {
        const markup = renderToStaticMarkup(createElement(HeldCommand, { held: { launchId: 'dev', command: 'bun dev', cwd: '/work/app' } }));
        expect(markup).not.toContain('=</span>');
        expect(markup).toContain('/work/app $ </span>bun dev');
    });
});
