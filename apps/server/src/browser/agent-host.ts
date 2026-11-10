import type { BrowserDriveAction } from '@ruimte/contracts';
import type { DriveOutcome, ShotOutcome } from './drive.ts';

/*
 * What a tool reaches a page through. One door for both kinds of page: one this machine runs itself
 * and one a client holds in a <webview>. Null is the answer when nobody has the page open at all.
 */
export interface BrowserDriveHost {
    drive(browserId: string, action: BrowserDriveAction): Promise<DriveOutcome | null>;
    /* Writes a png of the page under the machine's own folder; null when nobody has the page open. */
    shot(browserId: string): Promise<ShotOutcome | null>;
}
