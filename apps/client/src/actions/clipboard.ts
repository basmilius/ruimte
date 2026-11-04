import { copyText } from '@adecore/ui';
import { ActionRefusal } from '@ruimte/actions';

function noClipboard(): ActionRefusal {
    return new ActionRefusal('no-clipboard', 'This window has no clipboard to copy to.');
}

/* The clipboard for what is not text, such as a picture; a refusal where the window has none. */
export function clipboardOrRefuse(): Clipboard {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
        throw noClipboard();
    }
    return navigator.clipboard;
}

/* Copies text, and refuses when it did not reach the clipboard, so whoever asked hears it. */
export async function copyTextOrRefuse(text: string): Promise<void> {
    if (!(await copyText(text))) {
        throw noClipboard();
    }
}
