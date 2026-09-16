import type { Machine } from '@ruimte/pulsar';
import type { AccountStatus } from '@/pulsar/account';

/*
 * The web client at `station.ruimte.app`, built with `vite build --mode station`. Its origin serves
 * static files and nothing else: no daemon answers there, no desktop bridge sits beside it and no
 * Vite proxy forwards a socket, so the row of "this machine" is left idle and a person gets in
 * through the account.
 */
export const IS_STATION = import.meta.env?.MODE === 'station';

export type StationBoot = 'loading' | 'sign-in' | 'signing-in' | 'machines';

export interface StationBootInput {
    station: boolean;
    accountStatus: AccountStatus;
    machines: Machine[] | null;
}

/*
 * What the start screen of the web client leads with, or null for the desktop order. Without a machine
 * of its own the web client can do nothing before a machine of the account is there, so signing in
 * and then those machines come first.
 */
export const stationBoot = (input: StationBootInput): StationBoot | null => {
    if (!input.station) {
        return null;
    }
    switch (input.accountStatus) {
        case 'loading':
            return 'loading';
        case 'signing-in':
            return 'signing-in';
        case 'signed-out':
        case 'unavailable':
            return 'sign-in';
        case 'signed-in':
            return input.machines === null ? 'loading' : 'machines';
    }
};

/*
 * A page loaded over https may not open a plain http or ws connection, and the browser says so only in
 * its console. A machine paired by link on its own address is exactly that, so the refusal is a
 * sentence before anything is tried.
 */
export const mixedContentRefusal = (pageProtocol: string, machineUrl: string): string | null => {
    if (pageProtocol !== 'https:' || !/^(http|ws):/i.test(machineUrl)) {
        return null;
    }
    return 'This page is served over https, and a browser does not let it reach a machine on plain http. Add the machine to your account from the desktop app and open it here, or put it behind https.';
};
