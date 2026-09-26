import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { isApplePlatform } from './platform.ts';
import { formatShortcut } from './shortcut.ts';
import { ModifierHold, placeHint, shortcutHintTargets } from './shortcut-hints.ts';

interface PlacedHint {
    id: number;
    text: string;
    style: CSSProperties;
}

/* Whether a person can see the button now: on screen, not faded out, and not under a dialog or another node. */
const isSeen = (element: Element, rect: DOMRect): boolean => {
    if (rect.width === 0 || rect.height === 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) {
        return false;
    }
    if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
        return false;
    }
    const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
    return hit !== null && element.contains(hit);
};

const measureHints = (apple: boolean): PlacedHint[] => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const hints: PlacedHint[] = [];
    for (const [element, target] of shortcutHintTargets()) {
        const rect = element.getBoundingClientRect();
        if (!isSeen(element, rect)) {
            continue;
        }
        const placement = placeHint(rect, viewport);
        hints.push({
            id: target.id,
            text: formatShortcut(target.shortcut, apple),
            style: { left: placement.left, right: placement.right, top: placement.top, translate: `${placement.translateX} ${placement.translateY}` }
        });
    }
    return hints;
};

/*
 * Every visible button's shortcut, under the button, for as long as the modifier is held on its own.
 * Mounted once; the listener sits on the window in the capture phase so a terminal that keeps a key to
 * itself still takes the hints down. A page in a browser node has the keyboard to itself and shows none.
 */
export function ShortcutHints() {
    const [shown, setShown] = useState(false);
    const [hints, setHints] = useState<PlacedHint[]>([]);
    const holdRef = useRef<ModifierHold | null>(null);

    useEffect(() => {
        const hold = new ModifierHold(isApplePlatform(), setShown);
        holdRef.current = hold;
        const onKeyDown = (e: KeyboardEvent): void => hold.keyDown(e);
        const onKeyUp = (e: KeyboardEvent): void => hold.keyUp(e);
        // A click or a zoom with the modifier down is a gesture, not someone looking for a shortcut.
        const cancel = (): void => hold.cancel();
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('pointerdown', cancel, true);
        window.addEventListener('wheel', cancel, { capture: true, passive: true });
        window.addEventListener('blur', cancel);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('pointerdown', cancel, true);
            window.removeEventListener('wheel', cancel, true);
            window.removeEventListener('blur', cancel);
            hold.cancel();
        };
    }, []);

    // Measured before paint and then every frame, so a hint never shows where its button was.
    useLayoutEffect(() => {
        if (!shown) {
            return;
        }
        const apple = isApplePlatform();
        let frame = 0;
        let last = '';
        const measure = (): void => {
            // Focus that moved into a page takes the key-up with it, so the embedder never hears the modifier let go.
            if (document.activeElement?.tagName === 'WEBVIEW') {
                holdRef.current?.cancel();
                return;
            }
            const next = measureHints(apple);
            const signature = JSON.stringify(next);
            if (signature !== last) {
                last = signature;
                setHints(next);
            }
            frame = requestAnimationFrame(measure);
        };
        measure();
        return () => cancelAnimationFrame(frame);
    }, [shown]);

    if (!shown) {
        return null;
    }
    return createPortal(
        <div aria-hidden className="pointer-events-none fixed inset-0 z-(--z-shortcut-hints)">
            {hints.map((hint) => (
                <kbd
                    key={hint.id}
                    className="absolute rounded-md bg-text px-1.5 font-sans text-xs/tight font-medium whitespace-nowrap text-surface shadow-float"
                    style={hint.style}
                >
                    {hint.text}
                </kbd>
            ))}
        </div>,
        document.body
    );
}
