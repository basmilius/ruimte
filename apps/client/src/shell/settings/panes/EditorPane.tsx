import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary, Segmented } from '@basmilius/desktop-ui';
import { useSettingsTarget } from '@basmilius/desktop-ui/settings';
import { CodeSection } from '@/shell/settings/panes/CodeSection';
import { EditorGeneralTab } from '@/shell/settings/panes/EditorGeneralTab';
import { LanguageServersTab } from '@/shell/settings/panes/LanguageServersTab';
import { SmartKeysSection } from '@/shell/settings/panes/SmartKeysSection';

type EditorTab = 'general' | 'colors' | 'smartKeys' | 'languageServers';

const TABS: readonly EditorTab[] = ['general', 'colors', 'smartKeys', 'languageServers'];

/* The tab that holds the row a search result names, by the prefix of its id. */
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
    if (target.startsWith('editor.smartKeys.')) {
        return 'smartKeys';
    }
    return target.startsWith('editor.servers') ? 'languageServers' : null;
}

/* The code editor, a tab per kind of setting. */
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
            {tab === 'smartKeys' && <SmartKeysSection />}
            {tab === 'languageServers' && (
                <ErrorBoundary label={t('editor.servers.failed')} compact className="rounded-xl border border-border">
                    <LanguageServersTab />
                </ErrorBoundary>
            )}
        </>
    );
}
