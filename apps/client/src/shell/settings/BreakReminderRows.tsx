import { Select } from '@adecore/ui';
import { formatDuration } from '@adecore/ui/format';
import { SettingsRow } from '@adecore/ui/settings';
import { useTranslation } from 'react-i18next';
import { breakReminderOffered } from '@/shell/break-reminder';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { BREAK_STRETCHES } from '@/state/quiet-hours';
import { useSettings } from '@/state/settings';

/* A suggestion to take a break after a stretch of work, and the length of that stretch once it is on. */
export function BreakReminderRows() {
    const { t } = useTranslation('settings');
    const on = useSettings((s) => s.breakReminderOn);
    const minutes = useSettings((s) => s.breakReminderMinutes);
    const update = useSettings((s) => s.update);

    if (!breakReminderOffered()) {
        return null;
    }

    return (
        <>
            <SettingSwitchRow id="agents.breakReminder" setting="breakReminderOn" />
            {on && (
                <SettingsRow
                    indent
                    label={t('agents.breakReminder.stretch.label')}
                    description={t('agents.breakReminder.stretch.description')}
                    control={
                        <Select
                            label={t('agents.breakReminder.stretch.label')}
                            size="sm"
                            value={String(minutes)}
                            onValueChange={(value) => update({ breakReminderMinutes: Number(value) })}
                            items={BREAK_STRETCHES.map((stretch) => ({ value: String(stretch), label: formatDuration(stretch * 60_000) }))}
                        />
                    }
                />
            )}
        </>
    );
}
