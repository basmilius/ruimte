import { desktop, isDesktop } from '@/desktop/bridge';
import { type SettingsSearchRow } from '@/registry/settings-sections';
import { hasLocalMachine, hasOpenedMachine } from '@/state/local-machine';

export const MACHINE_SETTINGS_ROWS: readonly SettingsSearchRow[] = [
    // On the account row of the Account pane.
    { id: 'machines.signIn', section: 'machines', label: 'settings:machines.account.title', description: 'settings:machines.account.description' },
    {
        id: 'machines.thisComputer',
        section: 'machines',
        label: 'settings:machines.thisComputer.setUp.label',
        description: 'settings:machines.thisComputer.setUp.description',
        available: () => isDesktop() && !hasLocalMachine()
    },
    { id: 'machines.add', section: 'machines', label: 'settings:machines.add.title', description: 'settings:machines.add.description' },
    // On the detail of a machine this client opened: the one picked, else this machine.
    {
        id: 'machines.machine.identity',
        section: 'machines',
        label: 'settings:machineDialog.identity.title',
        description: 'settings:machineDialog.identity.description',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.broker',
        section: 'machines',
        label: 'settings:machine.broker.label',
        description: 'settings:machine.broker.description',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.lanDoor',
        section: 'machines',
        label: 'settings:machine.lanDoor.label',
        description: 'settings:machine.lanDoor.search',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.reach',
        section: 'machines',
        label: 'settings:machine.reach.label',
        description: 'settings:machine.reach.search',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.direct',
        section: 'machines',
        label: 'settings:machine.direct.label',
        description: 'settings:machine.direct.description',
        available: hasLocalMachine
    },
    {
        id: 'machines.machine.streaming',
        section: 'machines',
        label: 'settings:machine.streaming.label',
        description: 'settings:machine.streaming.description',
        available: hasOpenedMachine
    },
    // On the Storage tab of a machine's detail.
    {
        id: 'machines.machine.storage.output',
        section: 'machines',
        label: 'settings:storage.output.title',
        description: 'settings:storage.output.description',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.storage.cleanup',
        section: 'machines',
        label: 'settings:storage.cleanup.title',
        description: 'settings:storage.cleanup.description',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.storage.projects',
        section: 'machines',
        label: 'settings:storage.projects.title',
        description: 'settings:storage.projects.footer',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.startFolder',
        section: 'machines',
        label: 'settings:machine.startFolder.label',
        description: 'settings:machine.startFolder.search',
        available: hasOpenedMachine
    },
    {
        id: 'machines.machine.usageStats',
        section: 'machines',
        label: 'settings:machine.usageStats.label',
        description: 'settings:machine.usageStats.search',
        available: hasLocalMachine
    },
    {
        id: 'machines.machine.keepRunning',
        section: 'machines',
        label: 'settings:backgroundService.keepRunning.label',
        description: 'settings:backgroundService.keepRunning.description',
        available: () => hasLocalMachine() && desktop()?.backgroundService !== undefined
    },
    {
        id: 'machines.machine.stopRunning',
        section: 'machines',
        label: 'settings:backgroundService.stopRunning.label',
        description: 'settings:backgroundService.stopRunning.description',
        available: () => hasLocalMachine() && desktop()?.machine !== undefined
    }
];
