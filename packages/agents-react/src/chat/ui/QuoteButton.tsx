import { useEffect, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Quote } from 'lucide-react';
import { selectedAnswerQuote, type QuoteTaker } from './quote-selection';
import { Button } from '@ruimte/ui/Button';
import { FLOAT } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';

const GAP_PX = 6;
// Keeps the button's middle far enough from the edges that it never sticks out of the thread.
const EDGE_PX = 40;

interface Offer {
    quote: string;
    x: number;
    y: number;
}

/* The last line the range covers. A triple-click ends on an empty rect at the start of the next row. */
const lastLineOf = (range: Range): DOMRect | null => {
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
    return rects.at(-1) ?? null;
};

/*
 * A button under a selection in an answer that hands it to the composer. Quoting on the selection
 * alone grew the composer while the person was still selecting, which moved the thread under the
 * pointer. It only shows once the pointer is up, so a drag never has it jump along.
 */
export function QuoteButton({
    thread,
    frame,
    taker
}: {
    thread: RefObject<HTMLElement | null>;
    frame: RefObject<HTMLElement | null>;
    taker: RefObject<QuoteTaker | null>;
}) {
    const { t } = useTranslation('agent-chat');
    const [offer, setOffer] = useState<Offer | null>(null);

    useEffect(() => {
        let pressed = false;
        const read = (): void => {
            const selection = document.getSelection();
            const quote = taker.current === null ? null : selectedAnswerQuote(selection, thread.current);
            const box = frame.current;
            const line = quote === null || selection === null ? null : lastLineOf(selection.getRangeAt(0));
            if (quote === null || box === null || line === null) {
                setOffer(null);
                return;
            }
            const bounds = box.getBoundingClientRect();
            // The canvas may zoom the cell; the button is placed in the frame's own pixels.
            const zoom = box.offsetWidth > 0 ? bounds.width / box.offsetWidth : 1;
            const x = Math.min(Math.max((line.right - bounds.left) / zoom, EDGE_PX), box.offsetWidth - EDGE_PX);
            const y = (line.bottom - bounds.top) / zoom + GAP_PX;
            setOffer({ quote, x: Math.round(x), y: Math.round(y) });
        };
        const press = (): void => {
            pressed = true;
        };
        const release = (): void => {
            pressed = false;
            read();
        };
        const change = (): void => {
            if (pressed) {
                setOffer(null);
                return;
            }
            read();
        };
        document.addEventListener('pointerdown', press, true);
        document.addEventListener('pointerup', release, true);
        document.addEventListener('selectionchange', change);
        return () => {
            document.removeEventListener('pointerdown', press, true);
            document.removeEventListener('pointerup', release, true);
            document.removeEventListener('selectionchange', change);
        };
    }, [thread, frame, taker]);

    if (offer === null) {
        return null;
    }

    return (
        <Button
            size="sm"
            className={`${FLOAT} absolute z-10 -translate-x-1/2 select-none`}
            style={{ left: offer.x, top: offer.y }}
            // Pressing a button moves the selection, and the selection is what it quotes.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
                document.getSelection()?.removeAllRanges();
                taker.current?.(offer.quote);
                setOffer(null);
            }}
        >
            <Icon icon={Quote} size={12} />
            {t('composer.quote.add')}
        </Button>
    );
}
