import { Button, Dialog, Field, IconPicker, Input, SectionLabel } from '@adecore/ui';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import type { ProjectIconChoice, ProjectView } from '@ruimte/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { renameViewAction, setViewIconAction } from '@/actions/client-actions';
import { resetTitle } from '@/nodes/node-host';
import { PROJECT_ICON_KEYWORDS } from '@/project/project-icons';
import { useProjectIconGroups } from '@/project/use-project-icon-groups';
import { ViewGlyph } from '@/project/ViewGlyph';
import { viewGlyphOf } from '@/shell/cell-view';
import { submitOnEnter } from '@/shell/submit-on-enter';

/*
 * What one view is called and what it wears, the two together the way a project holds them. The mark
 * is written on every click, since a grid of icons only reads when it answers; the name waits for
 * the button, because half a name is not a name.
 */
export function ViewSettingsDialog({ view, onClose }: { view: ProjectView; onClose(): void }) {
    const { t } = useTranslation(['shell', 'common']);
    const glyph = viewGlyphOf(view);
    const chosen = glyph.icon;
    const given = view.name ?? '';
    const [name, setName] = useState(given);
    const iconGroups = useProjectIconGroups();

    const pick = (icon: ProjectIconChoice | null): void => setViewIconAction(view.id, icon);

    const save = (): void => {
        const typed = name.trim();
        if (typed !== given) {
            // An empty field is not a name: the view goes back to the one its own source gives it.
            if (typed === '') {
                resetTitle(view.id);
            } else {
                renameViewAction(view.id, typed);
            }
        }
        onClose();
    };

    return (
        <>
            <Dialog.Title>{t('viewSettings.title')}</Dialog.Title>

            <Field label={t('viewSettings.name')} hint={t('viewSettings.nameHint')} className="mt-4">
                <Input
                    autoFocus
                    aria-label={t('viewSettings.nameLabel')}
                    maxLength={MAX_TITLE_LENGTH}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={submitOnEnter(save)}
                />
            </Field>

            <SectionLabel render={<div />} className="mt-5 mb-1.5">
                {t('common:icon.label')}
            </SectionLabel>
            <div className="flex items-center gap-3">
                <ViewGlyph {...glyph} size={20} />
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-text">{name.trim() === '' ? given : name}</span>
                    <span className="truncate text-sm text-text-faint">{chosen ? t('viewIcon.pickedHere') : t('viewIcon.defaultForKind')}</span>
                </div>
            </div>

            <IconPicker
                icons={iconGroups}
                keywords={PROJECT_ICON_KEYWORDS}
                rows={7}
                value={chosen?.value ?? null}
                label={t('common:icon.symbol')}
                className="mt-4"
                onValueChange={(icon) => pick({ kind: 'lucide', value: icon as ProjectIconChoice['value'] })}
                onClear={() => pick(null)}
            />

            <div className="mt-4 flex items-center justify-end">
                <Button variant="primary" onClick={save}>
                    {t('common:action.done')}
                </Button>
            </div>
        </>
    );
}
