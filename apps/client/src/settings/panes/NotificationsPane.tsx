import { SettingsSection } from '@/machines/SettingsSection';
import { BreakReminderRows } from '@/settings/BreakReminderRows';
import { QuietHoursRows } from '@/settings/QuietHoursRows';
import { SoundRows } from '@/settings/SoundRows';

export function NotificationsPane() {
    return (
        <SettingsSection>
            <SoundRows />
            <QuietHoursRows />
            <BreakReminderRows />
        </SettingsSection>
    );
}
