import { describe, expect, test } from 'bun:test';
import { launchAgentPlist, systemdUnit } from '@adecore/service';
import { launchAgentPlist as previousPlist, systemdUnit as previousUnit } from './definitions';
import { daemonServiceSpec, commandLineServiceProgram } from './host';

describe('Ruimte service host', () => {
    test('keeps installed identity, log paths and daemon ownership across the extraction', () => {
        const spec = daemonServiceSpec({
            program: '/Apps/Ruimte & Tools/ruimte',
            args: ['--port', '4210'],
            home: '/Users/test',
            ruimteHome: '/Users/test/.ruimte',
            path: '/test/bin:/usr/bin'
        });
        expect(spec.label).toBe('app.ruimte.daemon');
        expect(spec.environment).toEqual({ RUIMTE_HOME: '/Users/test/.ruimte', PATH: '/test/bin:/usr/bin', RUIMTE_SERVICE: '1' });
        expect(spec.logFile).toBe('/Users/test/Library/Logs/Ruimte/daemon.log');
        expect(launchAgentPlist(spec)).toBe(previousPlist(spec));
        expect(systemdUnit(spec)).toBe(previousUnit(spec));
        expect(commandLineServiceProgram('/Users/test/.ruimte')).toBe('/Users/test/.ruimte/bin/ruimte');
    });
});
