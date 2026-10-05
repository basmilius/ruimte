import { useTranslation } from 'react-i18next';
import { Segmented, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { EditorFoldOutline } from '@ruimte/smart-editor';
import { FOLDING_GROUPS } from '@/shell/settings/folding-rows';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { FOLD_OUTLINES, useSettings } from '@/state/settings';

/* When the arrow that folds shows in the gutter, and what folds by itself the first time a file opens. */
export function EditorFoldingTab() {
    const { t } = useTranslation('settings');
    const folding = useSettings((s) => s.codeFolding);
    const outline = useSettings((s) => s.codeFoldOutline);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsSection title={t('editor.folding.outline.title')}>
                <SettingsRow
                    searchId="editor.folding.outline"
                    label={t('editor.folding.outline.label')}
                    description={t('editor.folding.outline.description')}
                    control={
                        <Segmented<EditorFoldOutline>
                            value={outline}
                            options={FOLD_OUTLINES.map((id) => ({ id, label: t(`editor.folding.outline.options.${id}`) }))}
                            label={t('editor.folding.outline.label')}
                            onValueChange={(value) => update({ codeFoldOutline: value })}
                        />
                    }
                />
            </SettingsSection>
            {FOLDING_GROUPS.map((group) => (
                <SettingsSection key={group.id} title={t(`editor.folding.${group.id}.title`)} description={t(`editor.folding.${group.id}.description`)}>
                    {group.rows.map((row) => (
                        <SettingsRow
                            key={row.field}
                            searchId={`editor.folding.${group.id}.${row.words}`}
                            label={t(`editor.folding.${group.id}.${row.words}.label`)}
                            description={t(`editor.folding.${group.id}.${row.words}.description`)}
                            control={
                                <Switch
                                    checked={folding[row.field]}
                                    onCheckedChange={(checked) => update({ codeFolding: { ...folding, [row.field]: checked } })}
                                    label={t(`editor.folding.${group.id}.${row.words}.label`)}
                                />
                            }
                        />
                    ))}
                </SettingsSection>
            ))}
        </>
    );
}
