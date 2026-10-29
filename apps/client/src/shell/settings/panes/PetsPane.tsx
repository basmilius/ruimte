import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Bot, ImageUp, MapPin, PawPrint, Pencil, Shapes, Trash2 } from 'lucide-react';
import { Button, Icon, IconButton, Select, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { useProviders } from '@adecore/agents-react/state';
import { BEAM_SETTINGS } from '@/pets/beam';
import { SHEET_LIMITS, stripsOf, usePetSprites, type CustomPetSprite } from '@/pets/custom-sprites';
import { CUSTOM_PET_PREFIX, PET_SETS, petChoiceKey, petChoiceOfKey, petSetsWith, type PetChoice } from '@/pets/pet-state';
import { lookOf, usePetPool } from '@/pets/use-pet-look';
import { PetFigureDialog, type PetFigureEdit } from '@/shell/settings/panes/PetFigureDialog';
import { PetsPreview } from '@/shell/settings/panes/PetsPreview';
import { FigureTile, SubagentsTile, TeleportTile, VisitorTile } from '@/shell/settings/panes/PetTiles';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { SettingSwitchRow } from '@/shell/settings/SettingSwitchRow';
import { useSettings, type PetsPlace } from '@/state/settings';

const PETS_PLACES: readonly PetsPlace[] = ['nodes', 'screen'];

/* A row of the figures table: what the set looks like, its name, and a switch that puts it among the pets. */
function FigureRow({
    choice,
    name,
    detail,
    on,
    last,
    sprites,
    onChange,
    actions
}: {
    choice: PetChoice;
    name: string;
    detail: string;
    on: boolean;
    last: boolean;
    sprites: readonly CustomPetSprite[];
    onChange: (on: boolean) => void;
    actions?: React.ReactNode;
}) {
    const { t } = useTranslation('settings');

    return (
        <tr data-pet-set={petChoiceKey(choice)} className="border-t border-border first:border-t-0">
            <td className="py-2 pr-3">
                <span className="flex" aria-label={t('pets.sprite.preview', { name })} role="img">
                    {/* A built-in set has a figure of its own for Codex; a strip a person added stands for every agent. */}
                    <FigureTile
                        looks={
                            choice.kind === 'built-in'
                                ? [lookOf(choice, 'claude', sprites), lookOf(choice, 'codex', sprites)]
                                : [lookOf(choice, 'claude', sprites)]
                        }
                    />
                </span>
            </td>
            <td className="w-full py-2 pr-3">
                <span className="block truncate text-sm text-text">{name}</span>
                <span className="block text-xs text-text-muted tabular-nums">{detail}</span>
            </td>
            <td className="py-2 pr-3">
                <span className="flex items-center gap-1">{actions}</span>
            </td>
            <td className="py-2 text-right">
                {/* The last set picked stays, so the pets always come from one. */}
                <Switch checked={on} disabled={on && last} label={t('pets.sprite.use', { name })} onCheckedChange={onChange} />
            </td>
        </tr>
    );
}

/* What a CLI without a figure of its own is set to: the figures switched on. */
const BY_POOL = 'default';

/*
 * A figure per CLI on this machine, such as a cat of your own for Claude and another for Codex. A CLI
 * on Default takes its pets from the figures switched on, as every CLI did before.
 */
function AgentFigures({ sprites }: { sprites: readonly CustomPetSprite[] }) {
    const { t } = useTranslation('settings');
    const providers = useProviders((s) => s.providers);
    const byAgent = useSettings((s) => s.petsByAgent);
    const update = useSettings((s) => s.update);
    const customIds = sprites.map((sprite) => sprite.id);

    const items = [
        { value: BY_POOL, label: t('pets.agents.default') },
        ...PET_SETS.map((set) => ({ value: set, label: t(`pets.sprite.sets.${set}`) })),
        ...sprites.map((sprite) => ({ value: `${CUSTOM_PET_PREFIX}${sprite.id}`, label: sprite.name }))
    ];

    const give = (agent: string, set: string): void => {
        const rest = Object.fromEntries(Object.entries(byAgent).filter(([each]) => each !== agent));
        update({ petsByAgent: set === BY_POOL ? rest : { ...rest, [agent]: set } });
    };

    if (providers.length === 0) {
        return null;
    }

    return (
        <SettingsRow searchId="pets.agents" label={t('pets.agents.label')} description={t('pets.agents.description')}>
            <ul className="flex flex-col gap-1">
                {providers.map((provider) => {
                    const given = byAgent[provider.kind];
                    // A figure given and removed since reads as Default, which is what the pets do then.
                    const value = given !== undefined && petChoiceOfKey(given, customIds) !== null ? given : BY_POOL;

                    return (
                        <li key={provider.kind} data-pet-agent={provider.kind} className="flex items-center gap-2">
                            <span className="min-w-0 grow truncate text-sm text-text">{provider.name}</span>
                            <Select
                                value={value}
                                label={t('pets.agents.choose', { name: provider.name })}
                                align="end"
                                items={items}
                                onValueChange={(next) => give(provider.kind, next)}
                            />
                        </li>
                    );
                })}
            </ul>
        </SettingsRow>
    );
}

/*
 * Pets on a page of their own: a preview of what the choices below put on a canvas, then whether they
 * come and where they stand, what they show, and the figures they come from, the built-in sets and the
 * strips a person added, which stay in this client.
 */
export function PetsPane() {
    const { t } = useTranslation('settings');
    const place = useSettings((s) => s.petsPlace);
    const beam = useSettings((s) => s.petsBeam);
    const update = useSettings((s) => s.update);
    const sprites = usePetSprites((s) => s.sprites);
    const remove = usePetSprites((s) => s.remove);
    const pool = usePetPool();
    const [edit, setEdit] = useState<PetFigureEdit | null>(null);

    const picked = pool.map(petChoiceKey);
    const pick = (key: string, on: boolean): void => update({ petsSets: petSetsWith(pool, key, on) });

    const open = (sprite: CustomPetSprite | null): void => setEdit({ sprite, open: true, round: (edit?.round ?? 0) + 1 });

    const saved = (sprite: CustomPetSprite): void => {
        // A figure a person just added joins the pets, beside the sets already picked; a changed one stays where it was.
        if (edit?.sprite === null) {
            update({ petsSets: petSetsWith(pool, `${CUSTOM_PET_PREFIX}${sprite.id}`, true) });
        }

        setEdit(edit === null ? null : { ...edit, open: false });
    };

    const removeSprite = (id: string): void => {
        const key = `${CUSTOM_PET_PREFIX}${id}`;
        remove(id);
        const rest = picked.filter((each) => each !== key);
        // A CLI that had this figure goes back to the figures switched on.
        const byAgent = Object.fromEntries(Object.entries(useSettings.getState().petsByAgent).filter(([, set]) => set !== key));
        update({ petsSets: rest.length > 0 ? rest : ['buddies'], petsByAgent: byAgent });
    };

    return (
        <>
            <PetsPreview />
            <SettingsSection title={t('pets.title')} icon={PawPrint}>
                <SettingSwitchRow id="pets.enabled" setting="pets" />
            </SettingsSection>
            <SettingsSection title={t('pets.groups.place')} icon={MapPin}>
                <SettingsRow
                    searchId="pets.place"
                    label={t('pets.place.label')}
                    description={t('pets.place.description')}
                    control={
                        <Select
                            value={place}
                            label={t('pets.place.label')}
                            align="end"
                            items={PETS_PLACES.map((each) => ({ value: each, label: t(`pets.place.${each}`) }))}
                            onValueChange={(next) => update({ petsPlace: next })}
                        />
                    }
                />
                <SettingSwitchRow id="pets.inViews" setting="petsInViews" />
            </SettingsSection>
            <SettingsSection title={t('pets.groups.show')} icon={Activity}>
                <SettingSwitchRow id="pets.subagents" setting="petsSubagents" leading={<SubagentsTile />} />
                <SettingSwitchRow id="pets.visitor" setting="petsVisitor" leading={<VisitorTile />} />
                <SettingsRow
                    searchId="pets.beam"
                    leading={<TeleportTile />}
                    label={t('pets.beam.label')}
                    description={t('pets.beam.description')}
                    control={
                        <Select
                            value={beam}
                            label={t('pets.beam.label')}
                            align="end"
                            items={BEAM_SETTINGS.map((each) => ({ value: each, label: t(`pets.beam.${each}`) }))}
                            onValueChange={(next) => update({ petsBeam: next })}
                        />
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('pets.sprite.label')} icon={Shapes}>
                <SettingsRow searchId="pets.sprite" label={t('pets.sprite.label')} description={t('pets.sprite.description')}>
                    <table className="w-full">
                        <caption className="sr-only">{t('pets.sprite.label')}</caption>
                        <tbody>
                            {PET_SETS.map((set) => (
                                <FigureRow
                                    key={set}
                                    choice={{ kind: 'built-in', set }}
                                    name={t(`pets.sprite.sets.${set}`)}
                                    detail={t('pets.sprite.builtIn')}
                                    on={picked.includes(set)}
                                    last={picked.length === 1}
                                    sprites={sprites}
                                    onChange={(on) => pick(set, on)}
                                />
                            ))}
                            {sprites.map((sprite) => {
                                const key = `${CUSTOM_PET_PREFIX}${sprite.id}`;
                                return (
                                    <FigureRow
                                        key={key}
                                        choice={{ kind: 'custom', id: sprite.id }}
                                        name={sprite.name}
                                        detail={t('pets.custom.stateCount', { count: Object.keys(stripsOf(sprite)).length })}
                                        on={picked.includes(key)}
                                        last={picked.length === 1}
                                        sprites={sprites}
                                        onChange={(on) => pick(key, on)}
                                        actions={
                                            <>
                                                <IconButton
                                                    icon={Pencil}
                                                    size="sm"
                                                    label={t('pets.custom.edit', { name: sprite.name })}
                                                    onClick={() => open(sprite)}
                                                />
                                                <IconButton
                                                    icon={Trash2}
                                                    size="sm"
                                                    label={t('pets.custom.remove', { name: sprite.name })}
                                                    onClick={() => removeSprite(sprite.id)}
                                                />
                                            </>
                                        }
                                    />
                                );
                            })}
                        </tbody>
                    </table>
                </SettingsRow>
                <SettingsRow
                    searchId="pets.custom"
                    label={t('pets.custom.label')}
                    description={t('pets.custom.description', {
                        frames: SHEET_LIMITS.maxFrames,
                        size: SHEET_LIMITS.maxFrame,
                        kilobytes: SHEET_LIMITS.bytes / 1024
                    })}
                    control={
                        <Button disabled={sprites.length >= SHEET_LIMITS.maxSprites} onClick={() => open(null)}>
                            <Icon icon={ImageUp} size={12} /> {t('pets.custom.add')}
                        </Button>
                    }
                />
            </SettingsSection>
            <SettingsSection title={t('pets.agents.title')} icon={Bot}>
                <AgentFigures sprites={sprites} />
            </SettingsSection>
            <PetFigureDialog key={edit?.round ?? 0} edit={edit} onClose={() => setEdit(edit === null ? null : { ...edit, open: false })} onSaved={saved} />
        </>
    );
}
