import { Select } from '@adecore/ui';
import { formatDuration } from '@adecore/ui/format';
import { SettingsRow } from '@adecore/ui/settings';
import { useTranslation } from 'react-i18next';
import { canTellIdle } from '@/desktop/bridge';
import { BREAK_STRETCHES } from '@/state/quiet-hours';
import { useSettings } from '@/state/settings';
import { SettingSwitchRow } from '@/surface/SettingSwitchRow';

export function BreakReminderRows() {
    const { t } = useTranslation('settings');
    const on = useSettings((s) => s.breakReminderOn);
    const minutes = useSettings((s) => s.breakReminderMinutes);
    const update = useSettings((s) => s.update);

    if (!canTellIdle()) {
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
