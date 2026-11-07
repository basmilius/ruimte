import { ButtonGroup, ErrorBoundary, IconButton, ScrollArea } from '@adecore/ui';
import { Mic, Square, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useKeyOf } from '@/shell/shortcut-overrides';
import { cancelDictation, observeSpeech, registerDictationTarget, toggleDictation, useDictation, type DictationInsertion } from './controller';
import { DictationButton } from './DictationButton';

const EMPTY_BANDS: number[] = [];

interface Props {
    targetRef: RefObject<HTMLElement | null>;
    buttonContainer?: HTMLElement | null;
    inlinePreview?: boolean;
    capture(): DictationInsertion | null;
    disabled?: boolean;
}

export function DictationControl(props: Props) {
    const { t } = useTranslation('voice');
    return (
        <ErrorBoundary label={t('dictation.failed')} compact className="relative">
            <Control {...props} />
        </ErrorBoundary>
    );
}

function Control({ targetRef, capture, disabled = false, buttonContainer, inlinePreview = false }: Props) {
    const { t } = useTranslation('voice');
    const id = useId();
    const dictationKey = useKeyOf('dictation');
    const latest = useRef(capture);
    const latestDisabled = useRef(disabled);
    const enabled = useDictation((state) => state.model?.enabled === true);
    const targetId = useDictation((state) => state.targetId);
    const phase = useDictation((state) => (state.targetId === id ? state.phase : 'idle'));
    const text = useDictation((state) => (state.targetId === id ? state.text : ''));
    const error = useDictation((state) => (state.targetId === id ? state.error : null));
    const bands = useDictation((state) => (state.targetId === id ? state.bands : EMPTY_BANDS));
    const active = id === targetId;
    useLayoutEffect(() => {
        latest.current = capture;
        latestDisabled.current = disabled;
    });
    useEffect(observeSpeech, []);
    // Registered whatever `disabled` says, since unregistering cancels: a socket blip would throw the words away.
    useEffect(() => {
        const element = targetRef.current;
        if (!element) {
            return;
        }
        return registerDictationTarget({ id, element, capture: () => latest.current(), disabled: () => latestDisabled.current });
    }, [id, targetRef]);
    if (!enabled || (disabled && !active)) {
        return null;
    }
    const toggle = (): void => {
        const element = targetRef.current;
        if (element) {
            toggleDictation({ id, element, capture: () => latest.current(), disabled: () => latestDisabled.current });
        }
    };
    if (buttonContainer !== undefined) {
        return (
            <>
                {buttonContainer &&
                    createPortal(<DictationButton phase={phase} error={error} size="sm" disabled={phase === 'finishing'} onToggle={toggle} />, buttonContainer)}
                {!inlinePreview && active && text && phase !== 'error' && (
                    <ScrollArea
                        render={<p />}
                        className="max-h-32"
                        viewportClassName="whitespace-pre-wrap break-words px-3.5 pb-2 text-sm text-text-muted"
                        aria-label={t('dictation.preview')}
                    >
                        {text}
                    </ScrollArea>
                )}
                {error && (
                    <span role="alert" className="sr-only">
                        {error}
                    </span>
                )}
            </>
        );
    }
    const label = active && phase !== 'error' ? t('dictation.stop') : t('dictation.start');
    return (
        <div className="flex min-w-0 flex-col gap-2 px-2 py-1" onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
                <ButtonGroup>
                    <IconButton
                        icon={active && phase !== 'error' ? Square : Mic}
                        label={label}
                        kbd={dictationKey}
                        aria-pressed={active && phase !== 'error'}
                        disabled={active && phase === 'finishing'}
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={toggle}
                    />
                    {active && <IconButton icon={X} label={t('dictation.cancel')} onClick={cancelDictation} />}
                </ButtonGroup>
                {active && (
                    <span role="status" className="text-xs text-text-muted">
                        {t(`dictation.${phase}`)}
                    </span>
                )}
                {active && phase === 'listening' && (
                    <div className="flex h-4 items-center gap-0.5" aria-hidden="true">
                        {bands.map((band, index) => (
                            <span key={index} className="w-0.5 rounded-full bg-accent" style={{ height: `${Math.max(2, Math.round(band * 16))}px` }} />
                        ))}
                    </div>
                )}
            </div>
            {!inlinePreview && active && text && (
                <ScrollArea
                    render={<p />}
                    className="max-h-32 overflow-hidden rounded-md border border-border bg-surface-sunken"
                    viewportClassName="whitespace-pre-wrap break-words p-2 text-sm text-text"
                    aria-label={t('dictation.preview')}
                >
                    {text}
                </ScrollArea>
            )}
            {active && error && (
                <p role="alert" className="text-xs text-status-error">
                    {error}
                </p>
            )}
        </div>
    );
}
