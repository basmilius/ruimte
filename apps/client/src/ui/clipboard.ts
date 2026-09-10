/*
 * The clipboard, as the app uses it. A browser hands text over only to a document that is focused
 * and allowed, and there is nothing a person can do about a refusal, so both sides stay quiet.
 */

export const copyText = (text: string): void => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
};

/* What is on the clipboard, or nothing at all when the browser will not say. */
export const readClipboardText = async (): Promise<string> => {
    try {
        return (await navigator.clipboard?.readText()) ?? '';
    } catch {
        return '';
    }
};
