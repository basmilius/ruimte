import { Select, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useTranslation } from 'react-i18next';
import { addCustomSoundPack } from '@/attention/custom-sounds';
import { SoundPackRows } from '@/attention/SoundPackRows';
import { useSettings } from '@/state/settings';
import { soundPackItems } from '@/state/sound-packs';

const NEW_PACK = 'new';

/* The pack the notification sounds come from and which events make one. */
export function SoundRows() {
    const { t } = useTranslation('settings');
    const pack = useSettings((s) => s.soundPack);
    const events = useSettings((s) => s.soundEvents);
    const custom = useSettings((s) => s.customSoundPacks);
    const update = useSettings((s) => s.update);

    return (
        <>
            <SettingsRow
                searchId="agents.sounds.pack"
                label={t('agents.sounds.pack.label')}
                description={t('agents.sounds.pack.description')}
                control={
                    <Select
                        label={t('agents.sounds.pack.label')}
                        size="sm"
                        value={pack}
                        onValueChange={(value) => {
                            if (value === NEW_PACK) {
                                addCustomSoundPack(t('agents.sounds.newPackName'));
                            } else {
                                update({ soundPack: value });
                            }
                        }}
                        items={[...soundPackItems(custom, t), { value: NEW_PACK, label: t('agents.sounds.newPack') }]}
                    />
                }
            />
            <SoundPackRows
                key={pack}
                pack={pack}
                eventControl={(event, label) => (
                    <Switch checked={events[event]} onCheckedChange={(next) => update({ soundEvents: { ...events, [event]: next } })} label={label} />
                )}
            />
        </>
    );
}
