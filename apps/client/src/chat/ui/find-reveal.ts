import { createContext, useContext, useEffect } from 'react';
import type { ChatFindField } from '@/chat/logic/search';

export interface FindReveal {
    itemId: string;
    field: ChatFindField;
}

/* The hit the find bar is on, so the row that folds it away can open. */
export const FindRevealContext = createContext<FindReveal | null>(null);

/* Opens a fold of this item while the find bar is on a hit inside it; it stays open once the bar moves on, as if a person opened it. */
export const useOpenForFind = (itemId: string, field: ChatFindField, setOpen: (open: boolean) => void): void => {
    const reveal = useContext(FindRevealContext);
    const wanted = reveal !== null && reveal.itemId === itemId && reveal.field === field;
    useEffect(() => {
        if (wanted) {
            setOpen(true);
        }
    }, [wanted, reveal, setOpen]);
};
