import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { RotateCcw } from 'lucide-react';
import { MAX_TITLE_LENGTH } from '@ruimte/actions';
import { type ProjectIconChoice, type ProjectView, viewIconOf } from '@ruimte/contracts';
import { renameViewAction } from '@/actions/client-actions';
import { ViewGlyph } from '@/project/ViewGlyph';
import { resetTitle } from '@/nodes/node-host';
import { useDocument } from '@/state/document';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { IconPicker } from '@/ui/IconPicker';

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

    const pick = (icon: ProjectIconChoice | null): void => useDocument.getState().setViewIcon(view.id, icon);

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
            <Dialog.Title className="text-base font-semibold text-text">{t('viewSettings.title')}</Dialog.Title>

            <div className={`${SECTION_LABEL} mt-4 mb-1.5`}>{t('viewSettings.name')}</div>
            <input
                autoFocus
                className="field"
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
            <p className="mt-1.5 text-sm text-text-faint">{t('viewSettings.nameHint')}</p>

            <div className={`${SECTION_LABEL} mt-5 mb-1.5`}>{t('common:icon.label')}</div>
            <div className="flex items-center gap-3">
                <ViewGlyph id={view.id} kind={view.kind} icon={chosen} provider={provider} path={view.kind === 'file' ? view.path : null} size={20} />
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-text">{name.trim() === '' ? given : name}</span>
                    <span className="truncate text-sm text-text-faint">{chosen ? t('viewIcon.pickedHere') : t('viewIcon.defaultForKind')}</span>
                </div>
            </div>

            <IconPicker value={chosen} gridLabel={t('common:icon.symbol')} onChange={pick} />

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
