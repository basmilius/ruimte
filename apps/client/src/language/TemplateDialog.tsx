import type { TemplateLanguage, TemplatePlace } from '@adecore/editor-react';
import { Button, Checkbox, Dialog, Field, FormError, Icon, Input, Menu, ScrollArea, Segmented, TextArea, messageOf } from '@adecore/ui';
import { POSTFIX_TEMPLATE_LANGUAGES, TEMPLATE_LANGUAGES, TEMPLATE_LIMITS, TEMPLATE_PLACES, type TemplateScope } from '@ruimte/contracts';
import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTemplateRequest } from '@/language/template-request';
import { inputOf, problemOf, type TemplateDraft } from './template-draft';
import type { TemplatesTracker } from './templates';

/* The variables the Insert variable menu offers, as the snippet text they stand for. `$EXPR` is the expression before the dot of a postfix template. */
const VARIABLES = [
    { id: 'selection', text: '$TM_SELECTED_TEXT' },
    { id: 'clipboard', text: '$CLIPBOARD' },
    { id: 'fileName', text: '$TM_FILENAME' },
    { id: 'date', text: '$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE' }
] as const;

const EXPRESSION = { id: 'expression', text: '$EXPR' } as const;

/* Adds or changes a template of the person's own or of the project. */
export function TemplateDialog({ draft, tracker, onClose }: { draft: TemplateDraft | null; tracker: TemplatesTracker; onClose(): void }) {
    const { t } = useTranslation('settings');
    const postfix = draft?.kind === 'postfix';
    const adding = draft?.id === undefined;
    const title = postfix
        ? t(adding ? 'editor.templates.dialog.titleAddPostfix' : 'editor.templates.dialog.titleEditPostfix')
        : t(adding ? 'editor.templates.dialog.titleAddLive' : 'editor.templates.dialog.titleEditLive');

    return (
        <Dialog.Root open={draft !== null} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Popup className="flex max-h-[90vh] w-[640px] flex-col">
                <ScrollArea viewportClassName="px-5 pt-4">
                    <Dialog.Title>{title}</Dialog.Title>
                    <Dialog.Description className="mt-1 mb-3 break-words">{t('editor.templates.dialog.description')}</Dialog.Description>
                </ScrollArea>
                {draft !== null && <Form key={draft.id ?? 'new'} start={draft} tracker={tracker} onClose={onClose} />}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* The form Save as Live Template opens, for the tracker of the project it was asked in. */
export function TemplateRequestDialog() {
    const request = useTemplateRequest((s) => s.request);
    const setRequest = useTemplateRequest((s) => s.setRequest);

    if (request === null) {
        return null;
    }

    return <TemplateDialog draft={request.draft} tracker={request.tracker} onClose={() => setRequest(null)} />;
}

function toggled<T>(list: readonly T[], item: T, on: boolean): T[] {
    return on ? [...list.filter((other) => other !== item), item] : list.filter((other) => other !== item);
}

function Form({ start, tracker, onClose }: { start: TemplateDraft; tracker: TemplatesTracker; onClose(): void }) {
    const { t } = useTranslation('settings');
    const [draft, setDraft] = useState(start);
    const [tried, setTried] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const area = useRef<HTMLTextAreaElement>(null);
    const postfix = draft.kind === 'postfix';
    const families: readonly TemplateLanguage[] = postfix ? POSTFIX_TEMPLATE_LANGUAGES : TEMPLATE_LANGUAGES;
    const variables = postfix ? [EXPRESSION, ...VARIABLES] : VARIABLES;
    const problem = tried ? problemOf(draft) : null;
    const set = (fields: Partial<TemplateDraft>): void => setDraft((current) => ({ ...current, ...fields }));

    // Typed into the field itself, so the caret ends after the variable and undo keeps working.
    function insert(text: string): void {
        const field = area.current;
        if (field === null) {
            return;
        }
        field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
        field.focus();
        set({ body: field.value });
    }

    async function save(): Promise<void> {
        setTried(true);
        if (problemOf(draft) !== null) {
            return;
        }
        setBusy(true);
        setFailure(null);
        try {
            if (await tracker.save(draft.scope, inputOf(draft))) {
                onClose();
            }
        } catch (error) {
            setFailure(messageOf(error, t('editor.templates.dialog.failed')));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <ScrollArea className="grow" viewportClassName="flex flex-col gap-3 px-5 pb-4">
                <Field orientation="horizontal" label={postfix ? t('editor.templates.dialog.keyPostfix') : t('editor.templates.dialog.key')}>
                    <Input
                        mono
                        autoFocus={draft.key === ''}
                        spellCheck={false}
                        maxLength={TEMPLATE_LIMITS.key}
                        value={draft.key}
                        onChange={(e) => set({ key: e.target.value })}
                    />
                </Field>
                <Field orientation="horizontal" label={t('editor.templates.dialog.descriptionLabel')}>
                    <Input maxLength={TEMPLATE_LIMITS.description} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
                </Field>
                <Field orientation="horizontal" label={t('editor.templates.dialog.body')} hint={t('editor.templates.dialog.bodyHint')}>
                    <div className="flex flex-col gap-2">
                        <TextArea
                            ref={area}
                            mono
                            rows={6}
                            spellCheck={false}
                            className="field-sizing-content"
                            value={draft.body}
                            onChange={(e) => set({ body: e.target.value })}
                        />
                        <Menu.Root>
                            <Menu.Trigger render={<Button size="sm" variant="secondary" className="self-start" />}>
                                {t('editor.templates.dialog.insertVariable')}
                                <Icon icon={ChevronDown} size={12} />
                            </Menu.Trigger>
                            <Menu.Popup align="start" className="min-w-48">
                                {variables.map((variable) => (
                                    <Menu.Item key={variable.id} onClick={() => insert(variable.text)}>
                                        {t(`editor.templates.dialog.variables.${variable.id}`)}
                                    </Menu.Item>
                                ))}
                            </Menu.Popup>
                        </Menu.Root>
                    </div>
                </Field>
                <Field orientation="horizontal" group label={t('editor.templates.dialog.languages')}>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {families.map((family) => (
                            <label key={family} className="flex min-h-8 items-center gap-2.5">
                                <Checkbox
                                    label={t(`editor.templates.languages.${family}`)}
                                    checked={draft.languages.includes(family)}
                                    onCheckedChange={(on) => set({ languages: toggled(draft.languages, family, on) })}
                                />
                                <span className="text-text">{t(`editor.templates.languages.${family}`)}</span>
                            </label>
                        ))}
                    </div>
                </Field>
                {!postfix && (
                    <Field orientation="horizontal" group label={t('editor.templates.dialog.places')}>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {TEMPLATE_PLACES.map((place) => (
                                <label key={place} className="flex min-h-8 items-center gap-2.5">
                                    <Checkbox
                                        label={t(`editor.templates.dialog.place.${place}`)}
                                        checked={draft.places.includes(place)}
                                        onCheckedChange={(on) => set({ places: toggled<TemplatePlace>(draft.places, place, on) })}
                                    />
                                    <span className="text-text">{t(`editor.templates.dialog.place.${place}`)}</span>
                                </label>
                            ))}
                        </div>
                    </Field>
                )}
                {postfix && (
                    <Field orientation="horizontal" group label={t('editor.templates.dialog.expression')}>
                        <Segmented<TemplateDraft['expression']>
                            label={t('editor.templates.dialog.expression')}
                            value={draft.expression}
                            onValueChange={(expression) => set({ expression })}
                            options={[
                                { id: 'any', label: t('editor.templates.dialog.expressionAny') },
                                { id: 'statement', label: t('editor.templates.dialog.expressionStatement') }
                            ]}
                        />
                    </Field>
                )}
                {start.id === undefined && (
                    <Field
                        orientation="horizontal"
                        group
                        label={t('editor.templates.dialog.where')}
                        hint={tracker.projectWritable ? undefined : t('editor.templates.dialog.whereNoProject')}
                    >
                        <Segmented<TemplateScope>
                            label={t('editor.templates.dialog.where')}
                            value={draft.scope}
                            onValueChange={(scope) => set({ scope })}
                            options={[
                                { id: 'personal', label: t('editor.templates.dialog.wherePersonal') },
                                { id: 'project', label: t('editor.templates.dialog.whereProject'), disabled: !tracker.projectWritable }
                            ]}
                        />
                    </Field>
                )}
            </ScrollArea>
            <div className="flex items-center gap-2 border-t border-border px-5 py-3">
                <span className="min-w-0 grow">{(problem ?? failure) !== null && <FormError className="break-words">{problem ?? failure}</FormError>}</span>
                <Dialog.Close render={<Button variant="secondary" />}>{t('editor.templates.dialog.cancel')}</Dialog.Close>
                <Button variant="primary" disabled={busy} onClick={() => void save()}>
                    {t('editor.templates.dialog.save')}
                </Button>
            </div>
        </>
    );
}
