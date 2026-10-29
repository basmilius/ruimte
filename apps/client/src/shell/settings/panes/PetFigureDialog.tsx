import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageUp, PawPrint, Trash2 } from 'lucide-react';
import { Button, FormError, Icon, IconButton, PromptDialog } from '@adecore/ui';
import {
    browserSheetReader,
    forgetUnusedImages,
    previewSpriteOf,
    readPetStrip,
    savePetSprite,
    SHEET_LIMITS,
    SHEET_TYPES,
    spriteOf,
    stripsOf,
    type CustomPetSprite,
    type PetStrip,
    type PetStrips,
    type SheetProblem
} from '@/pets/custom-sprites';
import type { PetLook } from '@/pets/paint';
import { PetFigure } from '@/pets/PetFigure';
import { PET_HEIGHT, PET_PAINT_WIDTH, type PetMood } from '@/pets/pet-state';
import { PET_POSES, type PetPose } from '@/pets/pixel';

/*
 * One opening of the dialog, for a new figure or one added before. It stays after a close, so the dialog
 * keeps what it showed while it fades out; the dialog is keyed on `round`, so every opening starts afresh.
 */
export interface PetFigureEdit {
    sprite: CustomPetSprite | null;
    open: boolean;
    round: number;
}

interface Draft {
    id: string;
    strips: PetStrips;
    problems: Partial<Record<PetPose, SheetProblem>>;
}

/* The mood a state's preview plays, with its bubble and jump; walking is a pose of its own, which no mood has. */
const PREVIEW_MOODS: Record<PetPose, PetMood> = { stand: 'visiting', walk: 'idle', work: 'working', wait: 'waiting', sleep: 'idle', stopped: 'stopped' };

function draftOf(edit: PetFigureEdit | null): Draft {
    return { id: edit?.sprite?.id ?? crypto.randomUUID(), strips: edit?.sprite ? stripsOf(edit.sprite) : {}, problems: {} };
}

function limitsOf(): Record<string, number> {
    return {
        kilobytes: SHEET_LIMITS.bytes / 1024,
        min: SHEET_LIMITS.minFrame,
        max: SHEET_LIMITS.maxFrame,
        frames: SHEET_LIMITS.maxFrames,
        limit: SHEET_LIMITS.maxSprites,
        total: SHEET_LIMITS.allBytes / 1024
    };
}

/* The rows live inside the popup, so the preview images go once it closes and its rows unmount. */
function StripRows({ children }: { children: ReactNode }) {
    useEffect(() => forgetUnusedImages, []);
    return <ul className="mt-4 flex max-h-[35dvh] flex-col gap-2 overflow-y-auto">{children}</ul>;
}

/* One state: its preview, what it plays, and a button for its file that says which state it is for. */
function StripRow({
    pose,
    strip,
    problem,
    look,
    reading,
    onChoose,
    onDrop
}: {
    pose: PetPose;
    strip: PetStrip | undefined;
    problem: SheetProblem | undefined;
    look: PetLook | null;
    reading: boolean;
    onChoose(): void;
    onDrop(): void;
}) {
    const { t } = useTranslation('settings');
    const chooseRef = useRef<HTMLButtonElement>(null);
    const problemId = useId();
    const state = t(`pets.custom.states.${pose}`);
    const plays =
        strip !== undefined
            ? t('pets.custom.frames', { count: strip.frames, size: strip.frameSize })
            : pose === 'stand'
              ? t('pets.custom.dialog.needed')
              : pose === 'stopped'
                ? t('pets.custom.dialog.tipped')
                : t('pets.custom.dialog.standing');
    return (
        <li data-pet-state={pose} className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
                <div className="shrink-0 rounded-md bg-field" style={{ width: PET_PAINT_WIDTH, height: PET_HEIGHT }}>
                    {look !== null && <PetFigure look={look} mood={PREVIEW_MOODS[pose]} crowded={false} pose={pose === 'walk' ? 'walk' : undefined} />}
                </div>
                <div className="flex min-w-0 grow flex-col">
                    <span className="truncate text-sm text-text">{state}</span>
                    <span className="truncate text-xs text-text-muted tabular-nums">{plays}</span>
                </div>
                <Button
                    ref={chooseRef}
                    disabled={reading}
                    aria-label={strip === undefined ? t('pets.custom.dialog.chooseFor', { state }) : t('pets.custom.dialog.replaceFor', { state })}
                    aria-describedby={problem === undefined ? undefined : problemId}
                    onClick={onChoose}
                >
                    <Icon icon={ImageUp} size={12} /> {strip === undefined ? t('pets.custom.dialog.choose') : t('pets.custom.dialog.replace')}
                </Button>
                {strip !== undefined && pose !== 'stand' && (
                    <IconButton
                        icon={Trash2}
                        size="sm"
                        label={t('pets.custom.dialog.drop', { state })}
                        onClick={() => {
                            onDrop();
                            // The button goes with the strip, so the keys stay on the row, on the button that gives it one again.
                            chooseRef.current?.focus();
                        }}
                    />
                )}
            </div>
            {problem !== undefined && <FormError id={problemId}>{t(`pets.custom.problem.${problem}`, limitsOf())}</FormError>}
        </li>
    );
}

/*
 * A figure as a strip per state, each with a preview of what a pet plays in it, and a name. Standing is
 * the one strip a figure needs: every state without one of its own plays it. Nothing is kept before Save.
 */
export function PetFigureDialog({ edit, onClose, onSaved }: { edit: PetFigureEdit | null; onClose(): void; onSaved(sprite: CustomPetSprite): void }) {
    const { t } = useTranslation('settings');
    const fileRef = useRef<HTMLInputElement>(null);
    const [held, setHeld] = useState<Draft>(() => draftOf(edit));
    const [target, setTarget] = useState<PetPose>('stand');
    const [reading, setReading] = useState(false);

    const preview = previewSpriteOf(held.id, held.strips);
    const look: PetLook | null = preview === null ? null : { kind: 'sheet', sprite: preview };

    const choose = (pose: PetPose): void => {
        setTarget(pose);
        fileRef.current?.click();
    };

    const pick = async (file: File | undefined): Promise<void> => {
        if (!file) {
            return;
        }
        const pose = target;
        setReading(true);
        const result = await readPetStrip(file, browserSheetReader);
        setReading(false);
        setHeld((draft) => ({
            ...draft,
            strips: 'strip' in result ? { ...draft.strips, [pose]: result.strip } : draft.strips,
            problems: { ...draft.problems, [pose]: 'problem' in result ? result.problem : undefined }
        }));
    };

    const drop = (pose: PetPose): void => {
        const without = <T,>(record: Partial<Record<PetPose, T>>): Partial<Record<PetPose, T>> =>
            Object.fromEntries(Object.entries(record).filter(([each]) => each !== pose));
        setHeld({ ...held, strips: without(held.strips), problems: without(held.problems) });
    };

    const save = async (name: string): Promise<void> => {
        const sprite = spriteOf(held.id, name, held.strips);
        if (sprite === null) {
            return;
        }
        const result = savePetSprite(sprite);
        if ('problem' in result) {
            throw new Error(t(`pets.custom.problem.${result.problem}`, limitsOf()));
        }
        onSaved(result.sprite);
    };

    return (
        <PromptDialog
            open={edit?.open === true}
            nested
            title={edit?.sprite ? t('pets.custom.dialog.edit') : t('pets.custom.dialog.new')}
            titleIcon={PawPrint}
            description={t('pets.custom.dialog.description')}
            field={{ label: t('pets.custom.dialog.name'), initial: edit?.sprite?.name ?? '', maxLength: SHEET_LIMITS.nameLength }}
            confirmLabel={t('pets.custom.dialog.save')}
            confirmDisabled={preview === null || reading}
            onConfirm={save}
            onOpenChange={onClose}
        >
            <input
                ref={fileRef}
                type="file"
                accept={SHEET_TYPES.join(',')}
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    void pick(file);
                }}
            />
            <StripRows>
                {PET_POSES.map((pose) => (
                    <StripRow
                        key={pose}
                        pose={pose}
                        strip={held.strips[pose]}
                        problem={held.problems[pose]}
                        look={look}
                        reading={reading}
                        onChoose={() => choose(pose)}
                        onDrop={() => drop(pose)}
                    />
                ))}
            </StripRows>
        </PromptDialog>
    );
}
