'use client';

import { Hash, StickyNote } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { CanvasNode } from '../../app/canvas.tsx';
import { AppWindow, Rail, Sidebar, TopRow } from '../../app/chrome.tsx';
import { Scaled } from '../../film/Stage.tsx';
import { NoteText } from './parts.tsx';

/* The tokens of the how-to's `themes/midnight.json`, set on the window as Ruimte sets a theme's on the page. */
const MIDNIGHT = {
    '--bg': '#050a1f',
    '--surface': '#0b1538',
    '--surface-raised': '#14204d',
    '--surface-sunken': '#060c26',
    '--surface-hover': '#1b2a60',
    '--surface-active': '#24367a',
    '--canvas-bg': '#050a1f',
    '--canvas-dot': '#22306b'
} as CSSProperties;

/* The window in the Midnight theme: Ruimte's dark base with the theme's tokens over it. */
export function ThemedWindow() {
    return (
        <Scaled
            width={960}
            height={540}
            label="A Ruimte window in the Midnight theme: the sidebar, the canvas and a note in deep blue instead of Ruimte's gray."
        >
            <div data-theme="dark" className="absolute inset-0" style={MIDNIGHT}>
                <AppWindow
                    sidebar={
                        <Sidebar
                            waiting={[]}
                            rows={[
                                { id: 'signup', name: 'Signup', icon: Hash, selected: true },
                                { id: 'brief', name: 'Brief', icon: StickyNote, nested: true }
                            ]}
                        />
                    }
                    toolbar={<TopRow view={{ icon: Hash, name: 'Signup' }} />}
                    rail={<Rail />}
                >
                    <div className="canvas-dots absolute inset-0">
                        <CanvasNode rect={{ x: 40, y: 40, w: 260, h: 140 }} kind="note" title="Brief">
                            <NoteText>
                                <p className="text-text-muted">Keep the email after a failed submit.</p>
                            </NoteText>
                        </CanvasNode>
                    </div>
                </AppWindow>
            </div>
        </Scaled>
    );
}

/* `AppearancePane.tsx` in Settings: Ruimte's own three themes, then a theme of an extension with its thumbnail. */
export function ThemePicker() {
    return (
        <figure className="mb-6" aria-label="The theme picker with System, Light, Dark and the extension theme Midnight, which is chosen.">
            <div aria-hidden className="flex flex-wrap gap-3.5 rounded-xl border border-border bg-surface p-4">
                <Choice label="System">
                    <Sample side="light" half />
                    <Sample side="dark" half />
                    <AccentMark className="absolute bottom-2.5 left-1/2 -translate-x-1/2" />
                </Choice>
                <Choice label="Light">
                    <Sample side="light" />
                </Choice>
                <Choice label="Dark">
                    <Sample side="dark" />
                </Choice>
                <Choice label="Midnight" chosen>
                    <img src="/docs/midnight-thumbnail.svg" alt="" className="h-full w-full object-cover" draggable={false} />
                </Choice>
            </div>
        </figure>
    );
}

/* A window in miniature, in the tokens of one side whatever the page is in. */
function Sample({ side, half = false }: { readonly side: 'light' | 'dark'; readonly half?: boolean }) {
    return (
        <span data-theme={side} className="flex min-w-0 grow flex-col gap-1.5 bg-surface-raised p-2.5">
            <span className={`h-1.5 rounded-full bg-surface-active ${half ? 'w-2/3' : 'w-3/5'}`} />
            <span className={`h-1.5 rounded-full bg-surface-hover ${half ? 'w-1/2' : 'w-2/5'}`} />
            {!half && <AccentMark className="mt-auto self-end" />}
        </span>
    );
}

function AccentMark({ className }: { readonly className: string }) {
    return <span className={`h-3 w-7 rounded-full bg-accent ${className}`} />;
}

function Choice({ label, chosen = false, children }: { readonly label: string; readonly chosen?: boolean; readonly children: ReactNode }) {
    return (
        <span className="flex flex-col items-center gap-2">
            <span
                className={`relative flex h-24 w-39 overflow-hidden rounded-[10px] ${chosen ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'ring-1 ring-border-strong'}`}
            >
                {children}
            </span>
            <span className={`text-xs ${chosen ? 'text-text' : 'text-text-muted'}`}>{label}</span>
        </span>
    );
}
