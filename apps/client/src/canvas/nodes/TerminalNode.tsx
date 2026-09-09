import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

interface Line {
    text: string;
    tone?: 'dim' | 'green' | 'blue' | 'yellow' | 'red';
}

const DEMO: Line[] = [
    { text: '$ bun dev', tone: 'dim' },
    { text: '' },
    { text: '  VITE v8.2.2  ready in 212 ms', tone: 'green' },
    { text: '' },
    { text: '  ➜  Local:   http://localhost:5173/', tone: 'blue' },
    { text: '  ➜  Network: use --host to expose', tone: 'dim' },
    { text: '' },
    { text: '12:41:07 [vite] hmr update /src/canvas/Canvas.tsx', tone: 'dim' },
    { text: '12:41:22 [vite] hmr update /src/styles.css', tone: 'dim' },
    { text: '12:42:03 [vite] hmr update /src/canvas/NodeFrame.tsx', tone: 'dim' },
    { text: '12:42:18 warning: unused export StatusDot', tone: 'yellow' }
];

const TONE: Record<NonNullable<Line['tone']>, string> = {
    dim: 'text-term-dim',
    green: 'text-term-green',
    blue: 'text-term-blue',
    yellow: 'text-term-yellow',
    red: 'text-term-red'
};

/* Placeholder for the real terminal. It only has to feel like one: monospace, a cursor, typed input. */
export function TerminalNode({ focused }: { id: string; focused: boolean }) {
    const [lines, setLines] = useState<Line[]>(DEMO);
    const [input, setInput] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (focused) {
            inputRef.current?.focus();
        }
    }, [focused]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [lines.length]);

    const submit = (): void => {
        const cmd = input.trim();
        setLines((prev) => [...prev, { text: `$ ${cmd}`, tone: 'dim' }, ...(cmd ? [{ text: `ruimte: command not found: ${cmd}`, tone: 'red' as const }] : [])]);
        setInput('');
    };

    return (
        <div ref={scrollRef} className="h-full overflow-auto bg-term-bg p-3 font-mono text-[12.5px] leading-[1.5] text-term-fg select-text">
            {lines.map((line, i) => (
                <div key={i} className={clsx('whitespace-pre', line.tone && TONE[line.tone])}>{line.text || ' '}</div>
            ))}
            <div className="flex whitespace-pre">
                <span className="text-term-dim">$ </span>
                <input
                    ref={inputRef}
                    className="grow bg-transparent outline-none"
                    value={input}
                    tabIndex={focused ? 0 : -1}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            submit();
                        }
                        if (e.key !== 'Escape') {
                            e.stopPropagation();
                        }
                    }}
                />
            </div>
        </div>
    );
}
