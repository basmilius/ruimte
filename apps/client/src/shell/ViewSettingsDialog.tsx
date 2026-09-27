import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { type ProjectIconChoice, type ProjectView, viewIconOf } from '@ruimte/contracts';
import { renameViewAction, setViewIconAction } from '@/actions/client-actions';
import { ViewGlyph } from '@/project/ViewGlyph';
import { resetTitle } from '@/nodes/node-host';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { Button, Icon, Dialog, Field, IconPicker, Input, SectionLabel } from '@basmilius/react-ui';

/*
 * What one view is called and what it wears, the two together the way a project holds them. The mark
 * is written on every click, since a grid of icons only reads when it answers; the name waits for
 * the button, because half a name is not a name.
 */
export function ViewSettingsDialog({ view, onClose }: { view: ProjectView; onClose(): void }) {
    const { t } = useTranslation(['shell', 'common']);
    const chosen = viewIconOf(view);
    const provider = view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null;
    const given = view.name ?? '';
    const [name, setName] = useState(given);

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
                    onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') {
                            save();
                        }
                    }}
                />
            </Field>

            <SectionLabel render={<div />} className="mt-5 mb-1.5">
                {t('common:icon.label')}
            </SectionLabel>
            <div className="flex items-center gap-3">
                <ViewGlyph id={view.id} kind={view.kind} icon={chosen} provider={provider} path={view.kind === 'file' ? view.path : null} size={20} />
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-text">{name.trim() === '' ? given : name}</span>
                    <span className="truncate text-sm text-text-faint">{chosen ? t('viewIcon.pickedHere') : t('viewIcon.defaultForKind')}</span>
                </div>
            </div>

            <IconPicker
                icons={PROJECT_ICON_GLYPHS}
                value={chosen?.value ?? null}
                label={t('common:icon.symbol')}
                className="mt-4"
                onValueChange={(icon) => pick({ kind: 'lucide', value: icon as ProjectIconChoice['value'] })}
            />

            <div className="mt-4 flex items-center gap-2">
                <Button disabled={!chosen} onClick={() => pick(null)}>
                    <Icon icon={RotateCcw} size={12} /> {t('viewIcon.useDefault')}
                </Button>
                <span className="grow" />
                <Button variant="primary" onClick={save}>
                    {t('common:action.done')}
                </Button>
            </div>
        </>
    );
}
