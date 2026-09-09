import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowUp, Square } from 'lucide-react';
import { Tooltip } from '@/ui/Tooltip';

interface ComposerProps {
    focused: boolean;
    busy: boolean;
    disabled: boolean;
    onSend(text: string): void;
    onCancel(): void;
}

export function Composer({ focused, busy, disabled, onSend, onCancel }: ComposerProps) {
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (focused) {
            inputRef.current?.focus();
        }
    }, [focused]);

    const send = (): void => {
        const text = draft.trim();
        if (!text || disabled) {
            return;
        }
        onSend(text);
        setDraft('');
    };

    return (
        <div
            className={clsx(
                'flex items-end gap-2 rounded-xl border bg-surface-raised px-3 py-2 transition-colors',
                focused ? 'border-accent' : 'border-border'
            )}
        >
            <textarea
                ref={inputRef}
                rows={1}
                placeholder={disabled ? 'Not connected to the Ruimte server' : 'Ask, or describe the change'}
                className="max-h-32 grow resize-none bg-transparent text-[13px] leading-relaxed text-text outline-none placeholder:text-text-faint"
                value={draft}
                disabled={disabled}
                tabIndex={focused ? 0 : -1}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                    }
                    // Escape still leaves node mode; every other key belongs to the text.
                    if (e.key !== 'Escape') {
                        e.stopPropagation();
                    }
                }}
            />
            {busy ? (
                <Tooltip label="Stop">
                    <button
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-text hover:bg-border"
                        onClick={onCancel}
                    >
                        <Square size={13} strokeWidth={2} />
                    </button>
                </Tooltip>
            ) : (
                <Tooltip label="Send" kbd="↵">
                    <button
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-text disabled:opacity-40"
                        disabled={!draft.trim() || disabled}
                        onClick={send}
                    >
                        <ArrowUp size={15} strokeWidth={2} />
                    </button>
                </Tooltip>
            )}
        </div>
    );
}
