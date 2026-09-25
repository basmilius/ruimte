'use client';

import { createContext, useContext } from 'react';
import type { VisualId } from './catalog.ts';

export const VisualContext = createContext<{ selected: VisualId; select: (visual: VisualId) => void } | null>(null);

export function useHeroVisual() {
    const context = useContext(VisualContext);
    if (!context) {
        throw new Error('Hero visuals need a HeroVisualProvider');
    }
    return context;
}
