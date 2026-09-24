import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { Mic, Square, X, LoaderCircle, CircleAlert } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { BTN_GROUP } from '@/ui/classes';
import { cancelDictation, observeSpeech, registerDictationTarget, toggleDictation, useDictation, type DictationInsertion } from './controller';

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
    const latest = useRef(capture);
    const enabled = useDictation((state) => state.model?.enabled === true);
    const targetId = useDictation((state) => state.targetId);
    const phase = useDictation((state) => (state.targetId === id ? state.phase : 'idle'));
    const text = useDictation((state) => (state.targetId === id ? state.text : ''));
    const error = useDictation((state) => (state.targetId === id ? state.error : null));
    const bands = useDictation((state) => (state.targetId === id ? state.bands : EMPTY_BANDS));
    const active = id === targetId;
    useLayoutEffect(() => {
        latest.current = capture;
    });
    useEffect(observeSpeech, []);
    useEffect(() => {
        const element = targetRef.current;
        if (!element || disabled) {
            return;
        }
        return registerDictationTarget({ id, element, capture: () => latest.current() });
    }, [id, targetRef, disabled]);
    if (!enabled || disabled) {
        return null;
    }
    const label = active && phase !== 'error' ? t('dictation.stop') : t('dictation.start');
    if (buttonContainer !== undefined) {
        const working = active && (phase === 'starting' || phase === 'finishing');
        const recording = active && phase === 'listening';
        const tooltip = error || (working ? t(`dictation.${phase}`) : label);
        return (
            <>
                {buttonContainer &&
                    createPortal(
                        <Tooltip label={tooltip} kbd={CANVAS_SHORTCUTS.dictation} name>
                            <button
                                type="button"
                                aria-pressed={recording}
                                aria-busy={working}
                                className={`icon-btn h-7 w-7 ${error ? 'text-status-error' : recording ? 'text-accent' : ''}`}
                                disabled={active && phase === 'finishing'}
                                onPointerDown={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                }}
                                onClick={() => {
                                    const element = targetRef.current;
                                    if (element) {
                                        toggleDictation({ id, element, capture: () => latest.current() });
                                    }
                                }}
                            >
                                <Icon
                                    icon={working ? LoaderCircle : recording ? Square : error ? CircleAlert : Mic}
                                    size={16}
                                    className={working ? 'animate-spin motion-reduce:animate-none' : undefined}
                                />
                            </button>
                        </Tooltip>,
                        buttonContainer
                    )}
                {!inlinePreview && active && text && phase !== 'error' && (
                    <p
                        className="max-h-32 overflow-auto whitespace-pre-wrap break-words px-3.5 pb-2 text-sm text-text-muted"
                        aria-label={t('dictation.preview')}
                    >
                        {text}
                    </p>
                )}
                {error && (
                    <span role="alert" className="sr-only">
                        {error}
                    </span>
                )}
            </>
        );
    }
    return (
        <div className="flex min-w-0 flex-col gap-2 px-2 py-1" onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
                <div className={BTN_GROUP}>
                    <Tooltip label={label} kbd={CANVAS_SHORTCUTS.dictation} name>
                        <button
                            type="button"
                            aria-pressed={active && phase !== 'error'}
                            className="icon-btn h-8 w-8"
                            disabled={active && phase === 'finishing'}
                            onPointerDown={(event) => event.preventDefault()}
                            onClick={() => {
                                const element = targetRef.current;
                                if (element) {
                                    toggleDictation({ id, element, capture: () => latest.current() });
                                }
                            }}
                        >
                            <Icon icon={active && phase !== 'error' ? Square : Mic} size={16} />
                        </button>
                    </Tooltip>
                    {active && (
                        <Tooltip label={t('dictation.cancel')} name>
                            <button type="button" className="icon-btn h-8 w-8" onClick={cancelDictation}>
                                <Icon icon={X} size={16} />
                            </button>
                        </Tooltip>
                    )}
                </div>
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
                <p
                    className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-sunken p-2 text-sm text-text"
                    aria-label={t('dictation.preview')}
                >
                    {text}
                </p>
            )}
            {active && error && (
                <p role="alert" className="text-xs text-status-error">
                    {error}
                </p>
            )}
        </div>
    );
}
