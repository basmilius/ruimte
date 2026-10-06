import i18next from 'i18next';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createSmartEditorEngine, type Editor } from '@adecore/editor';
import dutchEditor from '@adecore/editor-react/locales/nl.json' with { type: 'json' };
import dutchPanels from '@/i18n/locales/nl/panels.json' with { type: 'json' };
import { FileEditor } from '@/shell/panels/FileEditor';
import { FakeLanguageTransport } from '@/language/fake-daemon';
import { ProjectLanguage } from '@/language/ruimte-project-language';

export async function probeEditorLabels() {
    const container = document.createElement('div');
    container.style.cssText = 'width: 600px; height: 300px';
    document.body.append(container);
    const root = createRoot(container);
    const previousLanguage = i18next.language;
    const engine = createSmartEditorEngine({ tokenizer: async () => null });
    let mounted: Editor | null = null;
    const props = {
        engine,
        endpointId: 'editor-label-probe',
        path: '/work/app/example.ts',
        disk: { text: 'const total = 1;', mtime: 1 },
        language: 'typescript',
        wrap: false,
        indentation: { tabSize: 4, insertSpaces: true },
        rightMargin: null,
        readOnlyReason: null,
        placeholderScroll: { current: 0 },
        focused: null,
        reveal: null,
        onEditor: (editor: Editor | null) => {
            mounted = editor;
        }
    };
    const project = new ProjectLanguage(new FakeLanguageTransport(), 'editor-label-probe', '/work/app');
    try {
        await i18next.changeLanguage('en');
        flushSync(() => root.render(createElement(FileEditor, props)));
        const first = mounted;
        const english = container.querySelector('textarea')?.getAttribute('aria-label');
        i18next.addResourceBundle('nl', 'panels', dutchPanels, true, true);
        i18next.addResourceBundle('nl', 'editor', dutchEditor, true, true);
        await i18next.changeLanguage('nl');
        flushSync(() => root.render(createElement(FileEditor, props)));
        const dutch = container.querySelector('textarea')?.getAttribute('aria-label');
        return {
            english,
            dutch,
            sameEditor: first !== null && first === mounted,
            sameWords: project.i18n === i18next,
            featureWords: project.i18n.t('editor:language.codeVision.usagesNone')
        };
    } finally {
        flushSync(() => root.unmount());
        project.dispose();
        container.remove();
        await i18next.changeLanguage(previousLanguage);
    }
}
