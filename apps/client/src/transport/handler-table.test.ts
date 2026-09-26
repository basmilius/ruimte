import { describe, expect, test } from 'bun:test';
import { HandlerTable } from './handler-table';

describe('the handlers a client fans a stream out to', () => {
    test('every listener of one id hears it and no listener of another does', () => {
        const table = new HandlerTable<string>();
        const heard: string[] = [];
        table.listen('a', (value) => heard.push(`one ${value}`));
        table.listen('a', (value) => heard.push(`two ${value}`));
        table.listen('b', (value) => heard.push(`other ${value}`));

        table.fanOut('a', 'frame');

        expect(heard).toEqual(['one frame', 'two frame']);
    });

    test('a listener that stops hears nothing more, and an id nobody listens to is quiet', () => {
        const table = new HandlerTable<string>();
        const heard: string[] = [];
        const stop = table.listen('a', (value) => heard.push(value));

        table.fanOut('a', 'first');
        stop();
        table.fanOut('a', 'second');
        table.fanOut('nobody', 'third');

        expect(heard).toEqual(['first']);
    });

    // A frame handler that unsubscribes itself used to change the set being walked.
    test('a listener that stops while it runs does not cut the fan-out short', () => {
        const table = new HandlerTable<string>();
        const heard: string[] = [];
        const stop = table.listen('a', (value) => {
            heard.push(`first ${value}`);
            stop();
        });
        table.listen('a', (value) => heard.push(`second ${value}`));

        table.fanOut('a', 'frame');

        expect(heard).toEqual(['first frame', 'second frame']);
    });
});
