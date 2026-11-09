import { ErrorBoundary, Segmented } from '@adecore/ui';
import { useSettingsTarget } from '@adecore/ui/settings';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorAiTab } from '@/editor-ai/EditorAiTab';
import { LanguageServersTab } from '@/language/LanguageServersTab';
import { TemplatesTab } from '@/language/TemplatesTab';
import { CodeSection } from '@/settings/panes/CodeSection';
import { EditorFoldingTab } from '@/settings/panes/EditorFoldingTab';
import { EditorGeneralTab } from '@/settings/panes/EditorGeneralTab';
import { SmartKeysSection } from '@/settings/panes/SmartKeysSection';

type EditorTab = 'general' | 'colors' | 'folding' | 'smartKeys' | 'templates' | 'ai' | 'languageServers';

const TABS: readonly EditorTab[] = ['general', 'colors', 'folding', 'smartKeys', 'templates', 'ai', 'languageServers'];

function tabOfTarget(target: string | null): EditorTab | null {
    if (target === null) {
        return null;
    }
    if (target.startsWith('editor.general.')) {
        return 'general';
    }
    if (target.startsWith('editor.colors.')) {
        return 'colors';
    }
    if (target.startsWith('editor.folding.')) {
        return 'folding';
    }
    if (target.startsWith('editor.smartKeys.')) {
        return 'smartKeys';
    }
    if (target.startsWith('editor.templates.')) {
        return 'templates';
    }
    if (target.startsWith('editor.ai.')) {
        return 'ai';
    }
    return target.startsWith('editor.servers') ? 'languageServers' : null;
}

export function EditorPane() {
    const { t } = useTranslation('settings');
    const { target } = useSettingsTarget();
    const [tab, setTab] = useState<EditorTab>(() => tabOfTarget(target) ?? 'general');
    const [seenTarget, setSeenTarget] = useState(target);

    // A search result opens its own tab; adjusted while rendering so the row exists in the frame it is lit.
    if (target !== seenTarget) {
        setSeenTarget(target);
        const next = tabOfTarget(target);
        if (next !== null) {
            setTab(next);
        }
    }

    return (
        <>
            <Segmented<EditorTab>
                value={tab}
                options={TABS.map((id) => ({ id, label: t(`editor.tabs.${id}`) }))}
                label={t('editor.tabs.label')}
                onValueChange={setTab}
            />
            {tab === 'general' && <EditorGeneralTab />}
            {tab === 'colors' && <CodeSection />}
            {tab === 'folding' && <EditorFoldingTab />}
            {tab === 'smartKeys' && <SmartKeysSection />}
            {tab === 'templates' && (
                <ErrorBoundary label={t('editor.templates.failed')} compact className="rounded-xl border border-border">
                    <TemplatesTab />
                </ErrorBoundary>
            )}
            {tab === 'ai' && <EditorAiTab />}
            {tab === 'languageServers' && (
                <ErrorBoundary label={t('editor.servers.failed')} compact className="rounded-xl border border-border">
                    <LanguageServersTab />
                </ErrorBoundary>
            )}
        </>
    );
}
