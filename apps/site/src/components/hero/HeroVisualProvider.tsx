'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { isVisualId, type VisualId } from './catalog.ts';
import { VisualContext } from './visual-state.ts';

export function HeroVisualProvider({ children }: { readonly children: ReactNode }) {
    const [selected, setSelected] = useState<VisualId>('phosphor');

    useEffect(() => {
        const read = () => {
            const value = new URLSearchParams(window.location.search).get('visual');
            setSelected(isVisualId(value) ? value : 'phosphor');
        };
        read();
        window.addEventListener('popstate', read);
        return () => window.removeEventListener('popstate', read);
    }, []);

    const select = useCallback((visual: VisualId) => {
        setSelected(visual);
        const url = new URL(window.location.href);
        url.searchParams.set('visual', visual);
        window.history.replaceState(window.history.state, '', url);
    }, []);
    const value = useMemo(() => ({ selected, select }), [selected, select]);

    return <VisualContext value={value}>{children}</VisualContext>;
}
