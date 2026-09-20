import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@base-ui-components/react/dialog';
import type { FlowArgValue, FlowCard, FlowContent, FlowRun } from '@ruimte/contracts';
import { tokenKey, type FlowVisibleToken } from '@ruimte/flow';
import { formatMoment } from '@/format/datetime';
import { useFormatLocale } from '@/format/locale';
import { tokenLabel } from '@/flow/labels';
import { Button } from '@/ui/Button';
import { SECTION_LABEL } from '@/ui/classes';
import { Select } from '@/ui/Select';

interface FlowTokenDialogProps {
    content: FlowContent;
    /* What the cards above the one being tested would have published, and nothing more. */
    tokens: readonly FlowVisibleToken[];
    runs: readonly FlowRun[];
    /* Runs this test with these values. */
    onRun(values: Record<string, FlowArgValue>): void;
    /* Leaves the test waiting for the next time the trigger really fires. */
    onWait(): void;
    onClose(): void;
}

/* The example from the schema, which is what the fields start on. */
const examplesOf = (tokens: readonly FlowVisibleToken[]): Record<string, string> =>
    Object.fromEntries(tokens.map((entry) => [tokenKey(entry.cardId, entry.token.name), String(entry.token.example)]));

/* The values of an earlier run, for the tokens this test asks about. */
const fromRun = (tokens: readonly FlowVisibleToken[], run: FlowRun): Record<string, string> =>
    Object.fromEntries(
        tokens.map((entry) => {
            const key = tokenKey(entry.cardId, entry.token.name);
            return [key, run.tokens[key] === undefined ? '' : String(run.tokens[key])];
        })
    );

/* A run is worth offering when it carries at least one of the values this test is short of. */
const carries = (tokens: readonly FlowVisibleToken[], run: FlowRun): boolean =>
    tokens.some((entry) => run.tokens[tokenKey(entry.cardId, entry.token.name)] !== undefined);

/*
 * The values a test that starts halfway down a worksheet is short of. The cards above it never ran,
 * so what they would have published has to come from somewhere, and there are four somewheres in the
 * order they are worth reaching for: the next real firing, an earlier run, the example in the schema,
 * and your own hand. Only what is really needed is asked about, which is the same intersection that
 * decides what a card may use at all.
 */
export function FlowTokenDialog({ content, tokens, runs, onRun, onWait, onClose }: FlowTokenDialogProps) {
    const { t } = useTranslation('flow');
    const [values, setValues] = useState<Record<string, string>>(() => examplesOf(tokens));
    const [pickedRun, setPickedRun] = useState<string | null>(null);
    useFormatLocale();
    const past = runs.filter((run) => carries(tokens, run));

    const useRun = (runId: string): void => {
        const run = past.find((candidate) => candidate.id === runId);
        setPickedRun(runId);
        if (run !== undefined) {
            setValues(fromRun(tokens, run));
        }
    };

    return (
        <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Backdrop className="dialog-backdrop" />
                <Dialog.Popup className="dialog-popup flex max-h-[80vh] w-[460px] flex-col p-5">
                    <Dialog.Title className="text-base font-semibold text-text">{t('test.tokens.title')}</Dialog.Title>
                    <p className="mt-1 text-sm text-text-muted">{t('test.tokens.description')}</p>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button onClick={onWait}>{t('test.tokens.waitForReal')}</Button>
                        <Button onClick={() => setValues(examplesOf(tokens))}>{t('test.tokens.useExamples')}</Button>
                        {past.length > 0 && (
                            <Select
                                value={pickedRun}
                                onValueChange={useRun}
                                items={past.map((run) => ({ value: run.id, label: formatMoment(run.startedAt) }))}
                                label={t('test.tokens.fromRun')}
                                placeholder={t('test.tokens.fromRun')}
                                size="sm"
                            />
                        )}
                    </div>

                    <div className="mt-4 flex min-h-0 grow flex-col gap-3 overflow-y-auto">
                        {tokens.map((entry) => {
                            const key = tokenKey(entry.cardId, entry.token.name);
                            return (
                                <label key={key} className="flex flex-col gap-1.5">
                                    <span className={SECTION_LABEL}>
                                        {tokenLabel(t, content.cards[entry.cardId] as FlowCard, entry.token.name)}
                                        <span className="ml-1.5 font-normal text-text-faint">{t(`test.tokens.type.${entry.token.type}`)}</span>
                                    </span>
                                    <input
                                        className="field"
                                        value={values[key] ?? ''}
                                        // The canvas and the window listen on their own keys, and a value may hold any of them.
                                        onKeyDown={(e) => e.stopPropagation()}
                                        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                                    />
                                </label>
                            );
                        })}
                    </div>

                    <div className="mt-4 flex items-center justify-end gap-2">
                        <Button onClick={onClose}>{t('common:action.cancel')}</Button>
                        <Button variant="primary" onClick={() => onRun(typedValues(tokens, values))}>
                            {t('test.tokens.run')}
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/* What was typed, read back as the type the token publishes, so a number is a number in the run. */
const typedValues = (tokens: readonly FlowVisibleToken[], values: Readonly<Record<string, string>>): Record<string, FlowArgValue> => {
    const typed: Record<string, FlowArgValue> = {};
    for (const entry of tokens) {
        const key = tokenKey(entry.cardId, entry.token.name);
        const raw = values[key] ?? '';
        if (entry.token.type === 'number') {
            typed[key] = Number.isFinite(Number(raw)) ? Number(raw) : 0;
        } else if (entry.token.type === 'boolean') {
            typed[key] = raw === 'true';
        } else {
            typed[key] = raw;
        }
    }
    return typed;
};
