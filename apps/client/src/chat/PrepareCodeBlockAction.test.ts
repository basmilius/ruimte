import { expect, spyOn, test } from 'bun:test';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { clientActions } from '@/actions/client-action-registry';
import { prepareCodeBlockAction, type ShellCodeBlockContext } from './prepare-code-block';

const context: ShellCodeBlockContext = { scopeId: 'remote', chatId: 'chat', itemId: 'reply', language: 'bash', code: 'echo ok\n', complete: true };

test('rendering a completed shell block offers a person an action, without requesting or writing anything', () => {
    const execute = spyOn(clientActions, 'execute');
    try {
        const action = prepareCodeBlockAction(context);
        expect(action).not.toBeNull();
        const markup = renderToStaticMarkup(createElement(I18nextProvider, { i18n: i18next }, action));
        expect(markup).toContain('aria-label="Prepare in terminal"');
        expect(markup).not.toContain('role="dialog"');
        expect(execute).not.toHaveBeenCalled();
    } finally {
        execute.mockRestore();
    }
});

test('streaming, incomplete, multiline and non-shell blocks have no action', () => {
    for (const change of [{ complete: false }, { code: 'one\ntwo\n' }, { language: 'python' }, { code: 'echo\x1bnope' }]) {
        expect(prepareCodeBlockAction({ ...context, ...change } as ShellCodeBlockContext)).toBeNull();
    }
});
