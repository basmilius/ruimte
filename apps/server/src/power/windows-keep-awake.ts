import { dlopen, FFIType, JSCallback, ptr } from 'bun:ffi';
import type { HeldProcess, KeepAwakeBlock } from './keep-awake.ts';

/*
 * `SetThreadExecutionState` holds for as long as the calling thread lives, so the daemon's own main
 * thread holds the block: no process per agent turn, and a killed daemon lets go without a watchdog.
 * Windows has no "on the adapter only" flag, so a block that may not hold on battery follows the power
 * source itself, on the system's notification and never a clock.
 */

const ES_SYSTEM_REQUIRED = 0x1;
const ES_DISPLAY_REQUIRED = 0x2;
const ES_CONTINUOUS = 0x80000000;
const DEVICE_NOTIFY_CALLBACK = 2;
const AC_LINE_OFFLINE = 0;
// GUID_ACDC_POWER_SOURCE, 5d3e9a59-e9d5-4b00-a6bd-ff34ff516548, in its in-memory byte order.
const GUID_ACDC_POWER_SOURCE = new Uint8Array([0x59, 0x9a, 0x3e, 0x5d, 0xd5, 0xe9, 0x00, 0x4b, 0xa6, 0xbd, 0xff, 0x34, 0xff, 0x51, 0x65, 0x48]);

export interface WindowsPower {
    /* Returns 0 when Windows refused the state. */
    setExecutionState(flags: number): number;
    onAdapter(): boolean;
    /* Calls back on every change of the power source until the returned function is called. */
    watchPowerSource(changed: () => void): () => void;
}

export function executionStateOf(block: KeepAwakeBlock | null, onAdapter: boolean): number {
    if (block === null || (!block.onBattery && !onAdapter)) {
        return ES_CONTINUOUS;
    }
    return (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | (block.display ? ES_DISPLAY_REQUIRED : 0)) >>> 0;
}

/* The one execution state of this thread, for one block at a time. A new block replaces the old one in the same call, so nothing is uncovered in between. */
export class ExecutionStateHold {
    private readonly power: WindowsPower;
    private current: KeepAwakeBlock | null = null;
    private stopWatching: (() => void) | null = null;

    constructor(power: WindowsPower) {
        this.power = power;
    }

    hold(block: KeepAwakeBlock): HeldProcess {
        this.apply(block);
        this.current = block;
        try {
            this.watch();
        } catch (e) {
            // The caller then holds nothing, so nothing would ever release this.
            this.current = null;
            this.apply(null);
            throw e;
        }
        let end = (): void => undefined;
        const exited = new Promise<void>((resolve) => {
            end = resolve;
        });
        return {
            exited,
            kill: () => {
                // KeepAwake starts the new block first, so the old one no longer owns the state then.
                if (this.current === block) {
                    this.current = null;
                    this.watch();
                    this.apply(null);
                }
                end();
            }
        };
    }

    private apply(block: KeepAwakeBlock | null): void {
        if (this.power.setExecutionState(executionStateOf(block, this.power.onAdapter())) === 0) {
            throw new Error('SetThreadExecutionState refused the state');
        }
    }

    private watch(): void {
        const needed = this.current !== null && !this.current.onBattery;
        if (needed && this.stopWatching === null) {
            this.stopWatching = this.power.watchPowerSource(() => this.apply(this.current));
        } else if (!needed && this.stopWatching !== null) {
            this.stopWatching();
            this.stopWatching = null;
        }
    }
}

export function windowsPower(): WindowsPower {
    const kernel = dlopen('kernel32.dll', {
        SetThreadExecutionState: { args: [FFIType.u32], returns: FFIType.u32 },
        GetSystemPowerStatus: { args: [FFIType.ptr], returns: FFIType.i32 }
    });
    const powrprof = dlopen('powrprof.dll', {
        PowerSettingRegisterNotification: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
        PowerSettingUnregisterNotification: { args: [FFIType.ptr], returns: FFIType.u32 }
    });
    const status = new Uint8Array(12);
    return {
        setExecutionState: (flags) => kernel.symbols.SetThreadExecutionState(flags),
        onAdapter: () => {
            // Unknown (255) counts as the adapter: a machine that cannot say has no battery to protect.
            return kernel.symbols.GetSystemPowerStatus(ptr(status)) === 0 || status[0] !== AC_LINE_OFFLINE;
        },
        watchPowerSource: (changed) => {
            // A threadpool thread calls this, so it only wakes the JS thread, which reads the source itself.
            const callback = new JSCallback(
                () => {
                    changed();
                    return 0;
                },
                { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.u32, threadsafe: true }
            );
            const parameters = new BigUint64Array([BigInt(callback.ptr as unknown as number), 0n]);
            const handle = new BigUint64Array(1);
            const failure = powrprof.symbols.PowerSettingRegisterNotification(
                ptr(GUID_ACDC_POWER_SOURCE),
                DEVICE_NOTIFY_CALLBACK,
                ptr(parameters),
                ptr(handle)
            );
            if (failure !== 0) {
                callback.close();
                throw new Error(`PowerSettingRegisterNotification answered ${failure}`);
            }
            return () => {
                powrprof.symbols.PowerSettingUnregisterNotification(Number(handle[0]!) as never);
                callback.close();
            };
        }
    };
}
