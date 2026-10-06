import { describe, expect, test } from 'bun:test';
import { argumentText, browserEntry, CONSOLE_LIMITS, ConsoleLog, consoleLevel, consoleText, exceptionText } from './page-console.ts';

describe('console levels', () => {
    test('folds the console methods into the levels an agent reads', () => {
        expect(['log', 'debug', 'table', 'trace'].map(consoleLevel)).toEqual(['log', 'log', 'log', 'log']);
        expect(consoleLevel('info')).toBe('info');
        expect(consoleLevel('warning')).toBe('warning');
        expect(consoleLevel('error')).toBe('error');
        expect(consoleLevel('assert')).toBe('error');
        expect(consoleLevel('clear')).toBeNull();
        expect(consoleLevel('endGroup')).toBeNull();
    });
});

describe('console text', () => {
    test('primitives as themselves and objects the way the browser previews them', () => {
        expect(argumentText('plain')).toBe('plain');
        expect(argumentText(3)).toBe('3');
        expect(argumentText(null)).toBe('null');
        expect(argumentText(undefined)).toBe('undefined');
        const array = {
            type: 'object',
            subtype: 'array',
            description: 'Array(3)',
            preview: {
                subtype: 'array',
                properties: [
                    { type: 'number', value: '1' },
                    { type: 'number', value: '2' },
                    { type: 'number', value: '3' }
                ]
            }
        };
        expect(argumentText(array)).toBe('[1, 2, 3]');
        const object = {
            type: 'object',
            description: 'Object',
            preview: {
                description: 'Object',
                overflow: true,
                properties: [
                    { name: 'label', type: 'string', value: 'Bugs' },
                    {
                        name: 'nested',
                        type: 'object',
                        value: 'Object',
                        valuePreview: { description: 'Object', properties: [{ name: 'n', type: 'number', value: '1' }] }
                    }
                ]
            }
        };
        expect(argumentText(object)).toBe('{label: "Bugs", nested: {n: 1}, ...}');
        expect(argumentText({ type: 'object', subtype: 'error', description: 'Error: logged\n    at page.html:3:7' })).toBe(
            'Error: logged\n    at page.html:3:7'
        );
        expect(argumentText({ type: 'function', className: 'Function', description: 'function draw() {}' })).toBe('function draw() {}');
        expect(argumentText({ type: 'number', unserializableValue: 'NaN' })).toBe('NaN');
    });

    test('joins the arguments and fills in placeholders', () => {
        expect(consoleText(['bars', 3, 'drawn'])).toBe('bars 3 drawn');
        expect(consoleText(['%s of %d bars in %ims', 'two', '3.7', '12', 'extra'])).toBe('two of 3 bars in 12ms extra');
        expect(consoleText(['%cstyled', 'color: red'])).toBe('styled');
        expect(consoleText(['100%% and %s'])).toBe('100% and %s');
    });

    test('an uncaught error with its stack, and a thrown value with where it was thrown', () => {
        expect(
            exceptionText({
                text: 'Uncaught',
                exception: { type: 'object', subtype: 'error', description: 'TypeError: x is not a function\n    at draw (u:3:9)' }
            })
        ).toBe('Uncaught TypeError: x is not a function\n    at draw (u:3:9)');
        expect(exceptionText({ text: 'Uncaught', url: 'u', lineNumber: 4, columnNumber: 2, exception: { type: 'string', value: 'nope' } })).toBe(
            'Uncaught nope (u:5:3)'
        );
        expect(exceptionText({ text: "Uncaught SyntaxError: Unexpected token '}'", url: 'u', lineNumber: 0, columnNumber: 0 })).toBe(
            "Uncaught SyntaxError: Unexpected token '}' (u:1:1)"
        );
    });

    test("the browser's own errors and warnings name what failed, and the rest stays out", () => {
        expect(browserEntry({ level: 'error', text: 'Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED', url: 'http://127.0.0.1:9/x.js' })).toEqual({
            level: 'error',
            text: 'Failed to load resource: net::ERR_SOCKS_CONNECTION_FAILED (http://127.0.0.1:9/x.js)'
        });
        expect(browserEntry({ level: 'warning', text: 'A deprecated API' })).toEqual({ level: 'warning', text: 'A deprecated API' });
        expect(browserEntry({ level: 'verbose', text: '[Violation] Long task' })).toBeNull();
        expect(browserEntry({ level: 'info', text: 'An intervention' })).toBeNull();
    });
});

describe('ConsoleLog', () => {
    test('keeps the first messages on one line each, cut to size, and counts the rest', () => {
        const log = new ConsoleLog();
        log.add('exception', 'Uncaught Error: boom\n    at page.html:3:9\n    at page.html:7:1');
        log.add('log', `${'x'.repeat(CONSOLE_LIMITS.characters + 50)}`);
        for (let i = 0; i < CONSOLE_LIMITS.messages + 3; i++) {
            log.add('log', `message ${i}`);
        }
        expect(log.entries).toHaveLength(CONSOLE_LIMITS.messages);
        expect(log.entries[0]).toEqual({ level: 'exception', text: 'Uncaught Error: boom at page.html:3:9 at page.html:7:1' });
        expect(log.entries[1]!.text).toHaveLength(CONSOLE_LIMITS.characters);
        expect(log.entries[1]!.text.endsWith('...')).toBe(true);
        expect(log.omitted).toBe(5);
    });
});
