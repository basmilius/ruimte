import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

interface ModelsReasoningFilterProps {
    efforts: readonly string[];
    hidden: ReadonlySet<string>;
    onToggle(effort: string): void;
}

export function ModelsReasoningFilter({ efforts, hidden, onToggle }: ModelsReasoningFilterProps) {
    const { t } = useTranslation('models');
    return (
        <fieldset className="min-w-0">
            <legend className="text-xs font-medium text-text">{t('filters.reasoning')}</legend>
            <div className="mt-1 flex flex-wrap gap-x-0.5">
                {efforts.map((effort) => (
                    <button
                        key={effort}
                        type="button"
                        aria-pressed={!hidden.has(effort)}
                        className={clsx(
                            'min-h-6 rounded px-0.5 text-2xs hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent max-[760px]:min-h-8',
                            hidden.has(effort) ? 'text-text-faint line-through' : 'text-text'
                        )}
                        onClick={() => onToggle(effort)}
                    >
                        {t(`filterEfforts.${effort}`, { defaultValue: t(`efforts.${effort}`, { defaultValue: effort }) })}
                    </button>
                ))}
            </div>
        </fieldset>
    );
}
