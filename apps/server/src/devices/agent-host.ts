import type { DeviceDriver } from './agent-driver.ts';

export type DeviceDriveHost = Pick<
    DeviceDriver,
    | 'list'
    | 'find'
    | 'claim'
    | 'start'
    | 'pathFolders'
    | 'screen'
    | 'abilities'
    | 'power'
    | 'tree'
    | 'shot'
    | 'tap'
    | 'tapElement'
    | 'swipe'
    | 'button'
    | 'type'
    | 'launch'
    | 'act'
    | 'clipboard'
    | 'record'
>;
