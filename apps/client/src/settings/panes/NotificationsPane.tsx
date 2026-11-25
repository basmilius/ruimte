import { useTranslation } from 'react-i18next';
import { SettingsSection } from '@/machines/SettingsSection';
import { BreakReminderRows } from '@/settings/BreakReminderRows';
import { NotifyRows } from '@/settings/NotifyRows';
import { QuietHoursRows } from '@/settings/QuietHoursRows';
import { SoundRows } from '@/settings/SoundRows';

export function NotificationsPane() {
    const { t } = useTranslation('settings');

    return (
        <>
            <SettingsSection title={t('agents.notify.title')}>
                <NotifyRows />
            </SettingsSection>
            <SettingsSection title={t('agents.sounds.title')}>
                <SoundRows />
            </SettingsSection>
            <SettingsSection title={t('agents.rest.title')}>
                <QuietHoursRows />
                <BreakReminderRows />
            </SettingsSection>
        </>
    );
}
