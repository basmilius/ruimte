import { Skeleton } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import type { ListWords } from '@/shell/settings/use-machine-list';

/* The section around a list the machine keeps, with what it shows while the machine is silent, loading, empty or failed. */
export function MachineListSection({
    words,
    open,
    items,
    failure,
    children
}: {
    words: ListWords;
    open: boolean;
    items: readonly unknown[] | null;
    failure: string | null;
    children: ReactNode;
}) {
    const { t } = useTranslation('settings');
    const waiting = items === null && failure === null;

    return (
        <SettingsSection title={t(`${words}.title`)} description={t(`${words}.description`)}>
            {!open && waiting && <SettingsRow muted label={t(`${words}.silent.label`)} description={t(`${words}.silent.description`)} />}
            {open && waiting && <SettingsRow label={<Skeleton className="w-40" />} control={<Skeleton className="w-8" />} />}
            {items?.length === 0 && <SettingsRow muted label={t(`${words}.empty`)} />}
            {children}
            {failure && (
                <SettingsRow
                    muted
                    label={
                        <span className="break-words text-status-error" role="alert">
                            {failure}
                        </span>
                    }
                />
            )}
        </SettingsSection>
    );
}
