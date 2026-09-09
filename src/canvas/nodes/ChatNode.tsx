import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, FileCode2, Wrench } from 'lucide-react';
import clsx from 'clsx';

type Message =
    | { id: string; role: 'user'; text: string }
    | { id: string; role: 'assistant'; text: string; tool?: { name: string; detail: string; diff?: string[] } };

const DEMO: Message[] = [
    { id: 'm1', role: 'user', text: 'The terminal keeps losing focus when I Cmd+Tab back into the app. Can you make focus explicit state instead of pointer-driven?' },
    {
        id: 'm2',
        role: 'assistant',
        text: 'Focus now lives in the canvas store as a mode. A node owns the keyboard until you press Escape or click the pane, regardless of where the pointer is.',
        tool: {
            name: 'Edit',
            detail: 'src/state/canvas.ts',
            diff: [
                '-    hoverFocusedId: string | null;',
                '+    mode: { kind: "canvas" } | { kind: "node"; nodeId: string };',
                '+    enterNode(id: string): void;',
                '+    exitNode(): void;'
            ]
        }
    },
    { id: 'm3', role: 'assistant', text: 'Should the Escape key also clear the selection, or only leave node mode? I left it as a two-step so a stray Escape never drops a selection you were about to move.' }
];

export function ChatNode({ focused }: { id: string; focused: boolean }) {
    const [messages, setMessages] = useState<Message[]>(DEMO);
    const [draft, setDraft] = useState('');
    const [open, setOpen] = useState<Record<string, boolean>>({ m2: true });
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (focused) {
            inputRef.current?.focus();
        }
    }, [focused]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [messages.length]);

    const send = (): void => {
        const text = draft.trim();
        if (!text) {
            return;
        }
        setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', text }]);
        setDraft('');
    };

    return (
        <div className="flex h-full flex-col bg-surface">
            <div ref={scrollRef} className="min-h-0 grow space-y-4 overflow-auto px-4 py-4 select-text">
                {messages.map((m) => (
                    <div key={m.id} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                        {m.role === 'user' ? (
                            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[13px] leading-relaxed text-text">{m.text}</div>
                        ) : (
                            <div className="max-w-[92%] space-y-2 text-[13px] leading-relaxed text-text">
                                {m.tool && (
                                    <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
                                        <button
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text-muted hover:bg-surface-sunken"
                                            onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))}
                                        >
                                            <ChevronRight size={13} className={clsx('transition-transform', open[m.id] && 'rotate-90')} />
                                            <Wrench size={13} />
                                            <span className="font-medium text-text">{m.tool.name}</span>
                                            <FileCode2 size={13} className="ml-1" />
                                            <span className="font-mono">{m.tool.detail}</span>
                                        </button>
                                        {open[m.id] && m.tool.diff && (
                                            <pre className="border-t border-border bg-term-bg px-3 py-2 font-mono text-[11.5px] leading-[1.6]">
                                                {m.tool.diff.map((l, i) => (
                                                    <div key={i} className={clsx(l.startsWith('+') ? 'bg-status-idle/10 text-term-green' : l.startsWith('-') ? 'bg-status-error/10 text-term-red' : 'text-term-fg')}>{l}</div>
                                                ))}
                                            </pre>
                                        )}
                                    </div>
                                )}
                                <p>{m.text}</p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <div className="shrink-0 border-t border-border p-3">
                <div className={clsx('flex items-end gap-2 rounded-xl border bg-surface-raised px-3 py-2 transition-colors', focused ? 'border-accent' : 'border-border')}>
                    <textarea
                        ref={inputRef}
                        rows={1}
                        placeholder="Ask, or describe the change"
                        className="max-h-32 grow resize-none bg-transparent text-[13px] leading-relaxed text-text outline-none placeholder:text-text-faint"
                        value={draft}
                        tabIndex={focused ? 0 : -1}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                send();
                            }
                            if (e.key !== 'Escape') {
                                e.stopPropagation();
                            }
                        }}
                    />
                    <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-text disabled:opacity-40" disabled={!draft.trim()} onClick={send} title="Send">
                        <ArrowUp size={15} strokeWidth={2} />
                    </button>
                </div>
                <div className="mt-2 flex items-center gap-2 px-1 text-[11px] text-text-faint">
                    <span>Claude Code</span>
                    <span>·</span>
                    <span>Opus 5</span>
                    <span className="grow" />
                    <span>42% context</span>
                </div>
            </div>
        </div>
    );
}
