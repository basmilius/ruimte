import { expect, test } from 'bun:test';
import { settle } from '@adecore/editor-react/testing';
import { FakeEditorEngine } from '@adecore/editor/fake';
import i18next from 'i18next';
import { act } from 'react';
import { initReactI18next } from 'react-i18next';
import { FakeEditorAssistModel } from '@/editor-assist/fake-model';
import { useSettings } from '@/state/settings';
import { installWorkspace } from '@/wiring/workspace';
import { until } from '../../testing/dom';
import { FakeLanguageTransport } from './fake-daemon';
import { createEditorLanguage } from './ruimte-editor-language';
import { RuimteProject } from './ruimte-project';

// An editor is drawn only in a workspace, whose chunk installs this before it draws one (`App.tsx`).
installWorkspace();
// The hint renders in a React root of its own, which reads its words the way `initI18n` binds them in the app.
initReactI18next.init(i18next);

// The unit tests of ghost text hand in a mount of their own; this one draws the hint the app draws.
test('draws the hint while the model thinks and the keys that take the suggestion once it is there', async () => {
    useSettings.setState({ aiCodeHelp: true, aiGhostText: 'request' });
    const transport = new FakeLanguageTransport();
    const model = new FakeEditorAssistModel(transport);
    const project = new RuimteProject(transport, 'p1', '/work/app');
    const host = document.createElement('div');
    document.body.append(host);
    const editor = new FakeEditorEngine().mount(host, { text: 'const answer = \n', theme: 'light' });
    const language = createEditorLanguage(project, editor, 'file:///work/app/src/a.ts', 'typescript');
    await language.document.ready;
    editor.moveCaret({ line: 0, character: 15 });

    void language.app.ghost.request();
    await settle();

    const progress = document.createElement('div');
    const unmountProgress = await act(async () => editor.lineActionsByOwner.get('ghost-progress')![0]!.render(progress));
    await until(() => progress.textContent?.includes('Thinking') === true);

    await act(async () => model.answer('42;'));
    await settle();

    const ready = document.createElement('div');
    const unmountReady = await act(async () => editor.ghost!.accessory!(ready));
    await until(() => ready.textContent?.includes('Accept') === true);

    expect(ready.textContent).toContain('Editor model');
    await act(async () => {
        unmountProgress?.();
        unmountReady?.();
    });
    language.dispose();
    project.dispose();
    host.remove();
});
