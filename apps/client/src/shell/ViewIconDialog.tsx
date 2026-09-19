import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import { RotateCcw } from 'lucide-react';
import { type ProjectIconChoice, type ProjectView, viewIconOf } from '@ruimte/contracts';
import { ViewGlyph } from '@/project/ViewGlyph';
import { useDocument } from '@/state/document';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { IconPicker } from '@/ui/IconPicker';

/* Picks the mark one view wears: an emoji, one of the Lucide icons, or whatever its kind gives it. */
export function ViewIconDialog({ view, onClose }: { view: ProjectView; onClose(): void }) {
    const { t } = useTranslation(['shell', 'common']);
    const chosen = viewIconOf(view);
    const provider = view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null;

    const pick = (icon: ProjectIconChoice | null): void => useDocument.getState().setViewIcon(view.id, icon);

    return (
        <>
            <Dialog.Title className="text-base font-semibold text-text">{t('viewIcon.title')}</Dialog.Title>
            <div className="mt-3 flex items-center gap-3">
                <ViewGlyph id={view.id} kind={view.kind} icon={chosen} provider={provider} path={view.kind === 'file' ? view.path : null} size={20} />
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-text">{view.kind === 'separator' ? t('viewIcon.separator') : view.name}</span>
                    <span className="truncate text-sm text-text-faint">{chosen ? t('viewIcon.pickedHere') : t('viewIcon.defaultForKind')}</span>
                </div>
            </div>

            <IconPicker value={chosen} onChange={pick} />

            <div className="mt-4 flex items-center gap-2">
                <Button disabled={!chosen} onClick={() => pick(null)}>
                    <Icon icon={RotateCcw} size={12} /> {t('viewIcon.useDefault')}
                </Button>
                <span className="grow" />
                <Button variant="primary" onClick={onClose}>
                    {t('common:action.done')}
                </Button>
            </div>
        </>
    );
}
