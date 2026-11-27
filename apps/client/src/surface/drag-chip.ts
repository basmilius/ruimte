/* Where a drag began, and the element that is dragged. */
export interface DragOrigin {
    element: HTMLElement;
    clientX: number;
    clientY: number;
}

let started: DragOrigin | null = null;

/* Kept from the `dragstart` under way, for a source that is handed the payload and not the event. */
export function noteDragStart(event: DragEvent): void {
    started = event.target instanceof HTMLElement ? { element: event.target, clientX: event.clientX, clientY: event.clientY } : null;
}

export function dragStartOrigin(): DragOrigin | undefined {
    return started ?? undefined;
}

let chip: HTMLElement | null = null;
let stopChip: (() => void) | null = null;

function endChip(): void {
    stopChip?.();
    stopChip = null;
    chip?.remove();
    chip = null;
}

/* The system draws whatever element it is handed, so an element with nothing in it stands in for no picture at all. */
function blankImage(): HTMLElement {
    const blank = document.createElement('div');
    blank.style.cssText = 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.append(blank);

    return blank;
}

/*
 * Draws what is dragged in the page itself, in place of the picture the system makes of it. That
 * picture cannot be taken away once a drag is under way, and outside the window a window follows the
 * pointer in its place. The page's own picture goes the moment the drag leaves the page.
 */
export function startDragChip(transfer: DataTransfer, origin: DragOrigin): void {
    endChip();

    const box = origin.element.getBoundingClientRect();
    const grabX = Math.round(origin.clientX - box.left);
    const grabY = Math.round(origin.clientY - box.top);
    const blank = blankImage();
    const copy = origin.element.cloneNode(true) as HTMLElement;

    transfer.setDragImage(blank, 0, 0);
    copy.removeAttribute('id');
    copy.setAttribute('aria-hidden', 'true');
    copy.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;width:${Math.round(box.width)}px;height:${Math.round(box.height)}px;margin:0;pointer-events:none;opacity:0.9`;

    const moveTo = (x: number, y: number): void => {
        copy.style.transform = `translate(${Math.round(x - grabX)}px, ${Math.round(y - grabY)}px)`;
    };

    const onOver = (event: DragEvent): void => {
        copy.style.visibility = 'visible';
        moveTo(event.clientX, event.clientY);
    };

    const onLeave = (event: DragEvent): void => {
        // Without a related target the drag left the page, where nothing of the page can be drawn.
        if (event.relatedTarget === null) {
            copy.style.visibility = 'hidden';
        }
    };

    moveTo(origin.clientX, origin.clientY);
    document.body.append(copy);
    chip = copy;

    // In the capture phase, since a drop target may stop the event before it reaches the window.
    window.addEventListener('dragover', onOver, true);
    window.addEventListener('dragleave', onLeave, true);
    window.addEventListener('dragend', endChip, true);
    window.addEventListener('drop', endChip, true);

    stopChip = () => {
        blank.remove();
        window.removeEventListener('dragover', onOver, true);
        window.removeEventListener('dragleave', onLeave, true);
        window.removeEventListener('dragend', endChip, true);
        window.removeEventListener('drop', endChip, true);
    };
}
