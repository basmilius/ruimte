import { Select } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useTranslation } from 'react-i18next';
import { addCustomSoundPack } from '@/attention/custom-sounds';
import { useSoundPackItems } from '@/attention/sound-pack-items';
import { SoundPackRows } from '@/attention/SoundPackRows';
import { useSettings } from '@/state/settings';
import { isCustomPack } from '@/state/sounds';

const NEW_PACK = 'new';

/* The pack the notification sounds come from, and the files of a pack of a person's own. */
export function SoundRows() {
    const { t } = useTranslation('settings');
    const pack = useSettings((s) => s.soundPack);
    const update = useSettings((s) => s.update);
    const packs = useSoundPackItems();

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
                        items={[...packs, { value: NEW_PACK, label: t('agents.sounds.newPack') }]}
                    />
                }
            />
            {isCustomPack(pack) && <SoundPackRows key={pack} pack={pack} />}
        </>
    );
}
