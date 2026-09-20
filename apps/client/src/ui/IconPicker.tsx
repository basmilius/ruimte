import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Ban } from 'lucide-react';
import { PROJECT_ICON_NAMES, type ProjectIconChoice } from '@ruimte/contracts';
import { PROJECT_ICON_GLYPHS } from '@/project/project-icons';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

interface IconPickerProps {
    /* The mark as it stands. An image is picked somewhere else and reads here as nothing picked. */
    value: ProjectIconChoice | null;
    onChange(icon: ProjectIconChoice): void;
    disabled?: boolean;
    /* Clearing the mark. A surface that falls back to a default of its own offers that instead. */
    onClear?: () => void;
    /* A surface that also takes an image calls this grid something else, or the two read as one list. */
    gridLabel?: string;
}

/* The mark a project, a machine or a view wears: one of the Lucide icons, and nothing else. */
export function IconPicker({ value, onChange, disabled = false, onClear, gridLabel }: IconPickerProps) {
    const { t } = useTranslation('common');
    return (
        <>
            <div className={`${SECTION_LABEL} mt-4 mb-1.5 flex items-center gap-2`}>
                {gridLabel ?? t('icon.label')}
                {onClear && (
                    <>
                        <span className="grow" />
                        <Tooltip label={t('icon.none')} name>
                            <button className="icon-btn -my-1 h-7 w-7" disabled={disabled || value === null} onClick={onClear}>
                                <Icon icon={Ban} size={16} />
                            </button>
                        </Tooltip>
                    </>
                )}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(28px,1fr))] gap-1">
                {PROJECT_ICON_NAMES.map((name) => (
                    <Tooltip key={name} label={name} name>
                        <button
                            type="button"
                            disabled={disabled}
                            className={clsx(
                                'flex h-7 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-50',
                                value?.value === name ? 'bg-surface-active text-text' : 'text-text-muted'
                            )}
                            onClick={() => onChange({ kind: 'lucide', value: name })}
                        >
                            <Icon icon={PROJECT_ICON_GLYPHS[name]} size={16} />
                        </button>
                    </Tooltip>
                ))}
            </div>
        </>
    );
}
