import { MAX_KEY_COMBOS, MAX_TYPED_LENGTH } from '../index.ts';
import type { WriteCases } from './case.ts';

const identity = { endpointId: 'endpoint-1', name: 'Studio', keepAwake: 'working', broker: { mode: 'off' } } as const;
const swipe = { nodeId: 'device-1', fromX: 10, fromY: 600, toX: 10, toY: 100, ms: 300 };
const signal = { pid: 4210, startTime: 1_760_000_000, name: 'bun', signal: 'SIGTERM' } as const;

export const cases: WriteCases = {
    'computer.answerApproval': {
        actors: ['person'],
        input: { requestId: 'request-1', choice: 'once' },
        refused: { 'a choice it has not': { requestId: 'request-1', choice: 'later' }, 'an empty request': { requestId: '', choice: 'deny' } }
    },
    'computer.click': {
        actors: ['person', 'agent'],
        input: {
            app: 'Safari',
            element: 3,
            count: 2,
            button: 'right',
            wait: 6,
            front: false,
            withState: true,
            fullState: false,
            screenshot: false,
            maxDepth: 60
        },
        refused: {
            'a triple click and one': { app: 'Safari', element: 3, count: 4 },
            'a button it has not': { app: 'Safari', x: 10, y: 10, button: 'middle' },
            'a wait past what a call holds': { app: 'Safari', element: 3, wait: 111 },
            'a cut shorter than ten characters': { app: 'Safari', element: 3, maxText: 9 },
            'a pixel left of the shot': { app: 'Safari', x: -1, y: 0 },
            'no app': { element: 3 }
        }
    },
    'computer.type': {
        actors: ['person', 'agent'],
        input: { app: 'Notes', text: 'Hello\n' },
        refused: { 'nothing to type': { app: 'Notes', text: '' }, 'more than one call types': { app: 'Notes', text: 'x'.repeat(MAX_TYPED_LENGTH + 1) } }
    },
    'computer.key': {
        actors: ['person', 'agent'],
        input: { app: 'Notes', combos: ['cmd+n', 'return'], withState: true },
        refused: {
            'no combos': { app: 'Notes', combos: [] },
            'more combos than one call presses': { app: 'Notes', combos: Array.from({ length: MAX_KEY_COMBOS + 1 }, () => 'tab') }
        }
    },
    'computer.setValue': {
        actors: ['person', 'agent'],
        input: { app: 'System Settings', element: 12, value: '50' },
        refused: { 'no element': { app: 'System Settings', value: '50' }, 'an element by name': { app: 'System Settings', element: 'Volume', value: '50' } }
    },
    'computer.scroll': {
        actors: ['person', 'agent'],
        input: { app: 'Safari', element: 4, direction: 'down', pages: 2.5 },
        refused: {
            'no way to go': { app: 'Safari', element: 4 },
            'no distance': { app: 'Safari', element: 4, direction: 'down', pages: 0 },
            'past fifty pages': { app: 'Safari', element: 4, direction: 'up', pages: 51 }
        }
    },
    'computer.menu': {
        actors: ['person', 'agent'],
        input: { app: 'TextEdit', item: 'File > Save' },
        refused: { 'an empty item': { app: 'TextEdit', item: '' } }
    },
    'computer.drag': {
        actors: ['person', 'agent'],
        input: { app: 'Finder', from: 3, toX: 400, toY: 220 },
        refused: { 'a negative element': { app: 'Finder', from: -1, to: 2 }, 'a pixel above the shot': { app: 'Finder', fromX: 0, fromY: -3, to: 2 } }
    },
    'computer.open': {
        actors: ['person', 'agent'],
        input: { app: 'com.apple.TextEdit', front: true },
        refused: { 'an empty app': { app: '' } }
    },
    'device.tap': {
        actors: ['person', 'agent', 'extension'],
        input: { nodeId: 'device-1', x: 120, y: 340 },
        refused: { 'a negative element': { nodeId: 'device-1', element: -1 }, 'a fractional element': { nodeId: 'device-1', element: 1.5 } }
    },
    'device.swipe': {
        actors: ['person', 'agent'],
        input: swipe,
        refused: {
            'faster than a finger': { ...swipe, ms: 49 },
            'slower than five seconds': { ...swipe, ms: 5001 },
            'no end': { nodeId: 'device-1', fromX: 10, fromY: 600 }
        }
    },
    'device.button': {
        actors: ['person', 'agent'],
        input: { nodeId: 'device-1', button: 'home' },
        refused: { 'an empty button': { nodeId: 'device-1', button: '' } }
    },
    'device.type': {
        actors: ['person', 'agent'],
        input: { nodeId: 'device-1', text: 'ruimte\n' },
        refused: { 'nothing to type': { nodeId: 'device-1', text: '' }, 'past two thousand characters': { nodeId: 'device-1', text: 'x'.repeat(2001) } }
    },
    'device.launch': {
        actors: ['person', 'agent', 'extension'],
        input: { nodeId: 'device-1', app: 'app.ruimte.ios' },
        refused: { 'a blank app': { nodeId: 'device-1', app: ' ' }, 'an app id past its limit': { nodeId: 'device-1', app: 'x'.repeat(257) } }
    },
    'device.set': {
        actors: ['person', 'agent'],
        input: { nodeId: 'device-1', appearance: 'dark', statusBar: 'clean', battery: 40, charging: true, latitude: 52.37, longitude: 4.9 },
        refused: {
            'a battery past full': { nodeId: 'device-1', battery: 101 },
            'a latitude off the globe': { nodeId: 'device-1', latitude: 91, longitude: 0 },
            'a text size it has not': { nodeId: 'device-1', textSize: 'huge' }
        }
    },
    'device.open': {
        actors: ['person', 'agent'],
        input: { nodeId: 'device-1', url: 'https://ruimte.app' },
        refused: { 'a blank link': { nodeId: 'device-1', url: ' ' } }
    },
    'device.permission': {
        actors: ['person', 'agent'],
        input: { nodeId: 'device-1', app: 'app.ruimte.ios', decision: 'grant', permission: 'camera' },
        refused: {
            'a decision it has not': { nodeId: 'device-1', app: 'app.ruimte.ios', decision: 'allow' },
            'a permission it has not': { nodeId: 'device-1', app: 'app.ruimte.ios', decision: 'grant', permission: 'telepathy' }
        }
    },
    'device.push': {
        actors: ['person', 'agent'],
        input: { nodeId: 'device-1', app: 'app.ruimte.ios', payload: 'Build is green' },
        refused: { 'nothing to say': { nodeId: 'device-1', app: 'app.ruimte.ios', payload: '' } }
    },
    'device.biometric': {
        actors: ['person', 'agent'],
        input: { nodeId: 'device-1', event: 'match', sensor: 'face' },
        refused: {
            'an event it has not': { nodeId: 'device-1', event: 'blink' },
            'a sensor it has not': { nodeId: 'device-1', event: 'match', sensor: 'iris' }
        }
    },
    'device.clipboard': {
        actors: ['person', 'agent'],
        input: { nodeId: 'device-1', text: 'héllo' },
        refused: { 'more than a megabyte': { nodeId: 'device-1', text: 'x'.repeat(1_048_577) } }
    },
    'device.install': {
        actors: ['agent'],
        input: { nodeId: 'device-1', path: 'build/Atlas.app' },
        refused: { 'no path': { nodeId: 'device-1', path: '' } }
    },
    'device.media': {
        actors: ['agent'],
        input: { nodeId: 'device-1', paths: ['shots/a.png', 'clips/b.mov'] },
        refused: {
            'no pictures': { nodeId: 'device-1', paths: [] },
            'more than twenty': { nodeId: 'device-1', paths: Array.from({ length: 21 }, () => 'a.png') }
        }
    },
    'device.terminate': {
        actors: ['person', 'agent'],
        input: { nodeId: 'device-1', app: 'app.ruimte.ios' },
        refused: { 'a blank app': { nodeId: 'device-1', app: ' ' } }
    },
    'device.start': {
        actors: ['person', 'agent'],
        input: { nodeId: 'sim-1' },
        refused: { 'no device': { nodeId: '' } }
    },
    'machine.setIdentity': {
        actors: ['person'],
        input: identity,
        refused: {
            'a name past its limit': { ...identity, name: 'x'.repeat(81) },
            'a keep awake it has not': { ...identity, keepAwake: 'forever' },
            'a custom broker without an address': { ...identity, broker: { mode: 'custom' } },
            'no machine': { name: 'Studio' }
        }
    },
    'machine.setNodeSize': {
        actors: ['person'],
        input: { endpointId: 'endpoint-1', kind: 'terminal', size: { w: 640, h: 400 } },
        refused: {
            'a kind it has not': { endpointId: 'endpoint-1', kind: 'hologram', size: { w: 640, h: 400 } },
            'a size below what a frame is dragged to': { endpointId: 'endpoint-1', kind: 'terminal', size: { w: 100, h: 400 } },
            'a size of part of a pixel': { endpointId: 'endpoint-1', kind: 'terminal', size: { w: 640.5, h: 400 } },
            'no machine': { kind: 'terminal', size: null }
        }
    },
    'machine.setStartFolder': {
        actors: ['person'],
        input: { endpointId: 'endpoint-1', folder: 'D:\\Work' },
        refused: {
            'a folder past the longest path': { endpointId: 'endpoint-1', folder: 'x'.repeat(4097) },
            'no machine': { folder: '' }
        }
    },
    'machine.revokeAccess': {
        actors: ['person'],
        input: { endpointId: 'endpoint-1', sessionId: 'session-1' },
        refused: { 'an empty access': { endpointId: 'endpoint-1', sessionId: '' } }
    },
    'computer.control': {
        actors: ['person'],
        input: { endpointId: 'endpoint-1', action: 'pause' },
        refused: { 'an action the bar has not': { endpointId: 'endpoint-1', action: 'take-over' } }
    },
    'device.control': {
        actors: ['person'],
        input: { endpointId: 'endpoint-1', backendId: 'simctl', deviceId: 'device-1', mode: 'takeOver' },
        refused: {
            'a mode the strip has not': { endpointId: 'endpoint-1', backendId: 'simctl', deviceId: 'device-1', mode: 'stop' },
            'a backend past its limit': { endpointId: 'endpoint-1', backendId: 'x'.repeat(65), deviceId: 'device-1', mode: 'pause' }
        }
    },
    'process.dismissAlert': {
        actors: ['person', 'voice'],
        input: { alertId: 'alert-1' },
        refused: { 'an empty warning': { alertId: '' } }
    },
    'process.signal': {
        actors: ['person'],
        input: signal,
        refused: {
            'pid zero': { ...signal, pid: 0 },
            'a signal it does not send': { ...signal, signal: 'SIGHUP' },
            'no start time': { pid: 4210, name: 'bun', signal: 'SIGINT' }
        },
        confirms: true
    }
};
