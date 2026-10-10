// Safari reads the object URL after click() returns, so revoking it at once cancels the download.
const REVOKE_AFTER_MS = 60_000;

/* Hands a blob to the browser's own download, for a page without the desktop app's save dialog. */
export function downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
