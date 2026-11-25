import { IconButton, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { BellRing } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { previewEvent } from '@/attention/preview';
import { useSettings } from '@/state/settings';
import { SOUND_EVENTS } from '@/state/sounds';

/* Which events notify on this computer, each with a button that shows what its notification is like. */
export function NotifyRows() {
    const { t } = useTranslation('settings');
    const events = useSettings((s) => s.notifyEvents);
    const update = useSettings((s) => s.update);

    return (
        <>
            {SOUND_EVENTS.map((event) => {
                const label = t(`agents.sounds.events.${event}`);

                return (
                    <SettingsRow
                        key={event}
                        searchId={`agents.notify.${event}`}
                        label={label}
                        control={
                            <div className="flex items-center gap-2">
                                <IconButton
                                    icon={BellRing}
                                    size="sm"
                                    label={t('agents.notify.preview', { event: label })}
                                    onClick={() => previewEvent(event)}
                                />
                                <Switch
                                    checked={events[event]}
                                    onCheckedChange={(next) => update({ notifyEvents: { ...events, [event]: next } })}
                                    label={label}
                                />
                            </div>
                        }
                    />
                );
            })}
        </>
    );
}
