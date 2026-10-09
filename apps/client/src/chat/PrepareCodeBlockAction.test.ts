import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { prepareCodeBlockAction, type ShellCodeBlockContext } from './prepare-code-block';

const context: ShellCodeBlockContext = { scopeId: 'remote', chatId: 'chat', itemId: 'reply', language: 'bash', code: 'echo ok\n', complete: true };

test('rendering a completed shell block offers a person an action, without requesting or writing anything', () => {
    const action = prepareCodeBlockAction(context);
    expect(action).not.toBeNull();
    expect(renderToStaticMarkup(createElement(I18nextProvider, { i18n: i18next }, action))).toContain('aria-label="Prepare in terminal"');
    expect(renderToStaticMarkup(createElement(I18nextProvider, { i18n: i18next }, action))).not.toContain('role="dialog"');
});

test('streaming, incomplete, multiline and non-shell blocks have no action', () => {
    for (const change of [{ complete: false }, { code: 'one\ntwo\n' }, { language: 'python' }, { code: 'echo\x1bnope' }]) {
        expect(prepareCodeBlockAction({ ...context, ...change } as ShellCodeBlockContext)).toBeNull();
    }
});
