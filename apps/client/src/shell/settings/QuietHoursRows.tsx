import { Button, Input } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useTranslation } from 'react-i18next';
import { weekdayWords } from '@/routines/words';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { quietClockFrom } from '@/state/quiet-hours';
import { useSettings } from '@/state/settings';

const DAYS = [1, 2, 3, 4, 5, 6, 7];

/* The hours in which this computer raises no alert: a switch, and the days and times once it is on. */
export function QuietHoursRows() {
    const { t } = useTranslation('settings');
    const on = useSettings((s) => s.quietHoursOn);
    const days = useSettings((s) => s.quietHoursDays);
    const start = useSettings((s) => s.quietHoursStart);
    const end = useSettings((s) => s.quietHoursEnd);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingSwitchRow id="agents.quietHours" setting="quietHoursOn" />
            {on && (
                <>
                    <SettingsRow
                        indent
                        label={t('agents.quietHours.days.label')}
                        description={t('agents.quietHours.days.description')}
                        control={
                            <div className="flex flex-wrap justify-end gap-1" role="group" aria-label={t('agents.quietHours.days.label')}>
                                {DAYS.map((day) => {
                                    const listed = days.includes(day);

                                    return (
                                        <Button
                                            key={day}
                                            size="xs"
                                            variant={listed ? 'secondary' : 'ghost'}
                                            aria-pressed={listed}
                                            // At least one day stays, since hours on no day would be hours that are on and never quiet.
                                            disabled={listed && days.length === 1}
                                            onClick={() =>
                                                update({
                                                    quietHoursDays: listed
                                                        ? days.filter((entry) => entry !== day)
                                                        : [...days, day].sort((left, right) => left - right)
                                                })
                                            }
                                        >
                                            {weekdayWords(day)}
                                        </Button>
                                    );
                                })}
                            </div>
                        }
                    />
                    <SettingsRow
                        indent
                        label={t('agents.quietHours.times.label')}
                        description={t('agents.quietHours.times.description')}
                        control={
                            <div className="flex items-center gap-2">
                                <Input
                                    type="time"
                                    size="sm"
                                    className="w-28"
                                    aria-label={t('agents.quietHours.times.from')}
                                    value={start}
                                    onChange={(e) => update({ quietHoursStart: quietClockFrom(e.target.value, start) })}
                                />
                                <span className="text-xs text-text-muted">{t('agents.quietHours.times.to')}</span>
                                <Input
                                    type="time"
                                    size="sm"
                                    className="w-28"
                                    aria-label={t('agents.quietHours.times.until')}
                                    value={end}
                                    onChange={(e) => update({ quietHoursEnd: quietClockFrom(e.target.value, end) })}
                                />
                            </div>
                        }
                    />
                </>
            )}
        </>
    );
}
