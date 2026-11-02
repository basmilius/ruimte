import type { CSSProperties, ReactNode } from 'react';

/* A window of Ruimte in miniature: its ground, its edge and its three lights, drawn in the app's own tokens. */
export function MockWindow({ children, className = '' }: { readonly children: ReactNode; readonly className?: string }) {
    return (
        <div className={`overflow-hidden rounded-xl border border-border-strong bg-bg shadow-xl ${className}`}>
            <div className="flex h-7 items-center gap-1.5 border-b border-border bg-surface px-3">
                <span className="size-2.5 rounded-full bg-text/15" />
                <span className="size-2.5 rounded-full bg-text/15" />
                <span className="size-2.5 rounded-full bg-text/15" />
            </div>
            {children}
        </div>
    );
}

/* A figure with words under it, so a mockup that says nothing to a screen reader still says what it shows. */
export function MockFigure({ caption, children }: { readonly caption: string; readonly children: ReactNode }) {
    return (
        <figure className="mock-figure not-prose">
            <div aria-hidden>{children}</div>
            <figcaption>{caption}</figcaption>
        </figure>
    );
}

/* A node on the canvas: a header with a title, and a body of a few lines. */
export function MockNode({
    title,
    children,
    accent = false,
    className = '',
    style
}: {
    readonly title: string;
    readonly children?: ReactNode;
    readonly accent?: boolean;
    readonly className?: string;
    readonly style?: CSSProperties;
}) {
    return (
        <div
            className={`flex flex-col overflow-hidden rounded-lg border bg-surface ${accent ? 'border-accent/60' : 'border-border-strong'} ${className}`}
            style={style}
        >
            <div className="flex h-6 shrink-0 items-center gap-1.5 border-b border-border px-2 text-2xs text-text-muted">{title}</div>
            <div className="flex grow flex-col gap-1.5 p-2">{children}</div>
        </div>
    );
}

/* A line of text, as a bar: a mockup shows where words go, not the words themselves. */
export function MockLine({ width, tone = 'muted' }: { readonly width: string; readonly tone?: 'muted' | 'faint' | 'accent' }) {
    const color = tone === 'accent' ? 'bg-accent/50' : tone === 'faint' ? 'bg-text/8' : 'bg-text/14';

    return <span className={`block h-1.5 rounded-full ${color}`} style={{ width }} />;
}

/* What a slot is called, on the spot it marks. */
export function SlotLabel({ name, className = '' }: { readonly name: string; readonly className?: string }) {
    return <span className={`rounded bg-accent px-1 font-mono text-2xs text-accent-text ${className}`}>{name}</span>;
}
