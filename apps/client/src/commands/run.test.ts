import { afterEach, describe, expect, jest, spyOn, test } from 'bun:test';
import { behaviorOf } from '@/commands/behavior';
import { generatedKinds } from '@/commands/generated';
import { commandIds, commandSpec } from '@/commands/registry';
import { runMenuCommand } from '@/commands/run';

function menuCommand(palette: boolean): string {
    const id = commandIds().find((candidate) => {
        const behavior = behaviorOf(candidate);
        // A palette row with a condition, so a test can say whether the palette offers it.
        return (
            behavior !== undefined && behavior.afterClose !== true && (!palette || behavior.offered !== undefined) && commandSpec(candidate).palette === palette
        );
    });
    if (id === undefined) {
        throw new Error(`No registered command has a behavior with palette ${palette}.`);
    }

    return id;
}

describe('runMenuCommand', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test('runs a row the palette does not have at once', () => {
        const id = menuCommand(false);
        const run = spyOn(behaviorOf(id)!, 'run').mockImplementation(() => {});

        runMenuCommand(id);

        expect(run).toHaveBeenCalledTimes(1);
        run.mockRestore();
    });

    test('runs a row the palette has after the click has finished closing the menu', () => {
        jest.useFakeTimers();
        const id = menuCommand(true);
        const run = spyOn(behaviorOf(id)!, 'run').mockImplementation(() => {});
        const offered = spyOn(behaviorOf(id)!, 'offered').mockImplementation(() => true);

        runMenuCommand(id);
        expect(run).not.toHaveBeenCalled();
        jest.runAllTimers();

        expect(run).toHaveBeenCalledTimes(1);
        run.mockRestore();
        offered.mockRestore();
    });

    test('runs nothing for a row the palette no longer offers, which a menu built before the change still shows', () => {
        jest.useFakeTimers();
        const id = menuCommand(true);
        const run = spyOn(behaviorOf(id)!, 'run').mockImplementation(() => {});
        const offered = spyOn(behaviorOf(id)!, 'offered').mockImplementation(() => false);

        runMenuCommand(id);
        jest.runAllTimers();

        expect(run).not.toHaveBeenCalled();
        run.mockRestore();
        offered.mockRestore();
    });

    test('hands a generated row the part of its id after the prefix', () => {
        const kind = generatedKinds().find((candidate) => candidate.run !== undefined);
        expect(kind).toBeDefined();
        const run = spyOn(kind!, 'run').mockImplementation(() => {});

        runMenuCommand(`${kind!.prefix}some-id`);

        expect(run).toHaveBeenCalledWith('some-id');
        run.mockRestore();
    });
});
