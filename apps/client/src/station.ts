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
export function stationBoot(input: StationBootInput): StationBoot | null {
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
}
