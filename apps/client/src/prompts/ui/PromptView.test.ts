import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { emptyPromptDraft } from '@/prompts/logic/prompts';
import { PromptView } from './PromptView';

const RISK = 'In Ruimte an agent can do anything you can, at your own risk.';

const computerCard = (bundleId: string, name: string): string =>
    renderToStaticMarkup(
        createElement(
            I18nextProvider,
            { i18n: i18next },
            createElement(PromptView, {
                subject: {
                    kind: 'computer-approval',
                    nodeId: 'chat-1',
                    request: {
                        requestId: 'computer-1',
                        nodeId: 'chat-1',
                        surface: 'chat',
                        nodeTitle: 'Docs',
                        projectId: 'p1',
                        projectName: 'Ruimte',
                        app: { name, bundleId },
                        command: 'state',
                        createdAt: 7,
                        expiresAt: 600_007
                    }
                },
                draft: emptyPromptDraft(),
                onDraft: () => undefined,
                onAction: () => undefined,
                more: 0,
                hasDraft: false,
                denyReason: false,
                disabled: false,
                sending: false,
                error: null
            })
        )
    );

describe('a computer use card', () => {
    test('says that letting an agent into Ruimte itself is at your own risk, packaged and dev', () => {
        expect(computerCard('app.ruimte.desktop', 'Ruimte')).toContain(RISK);
        expect(computerCard('app.ruimte.desktop.dev', 'Ruimte Dev')).toContain(RISK);
    });

    test('says nothing of the kind for another app', () => {
        expect(computerCard('com.example.textedit', 'TextEdit')).not.toContain(RISK);
    });
});
