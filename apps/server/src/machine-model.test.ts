import { describe, expect, test } from 'bun:test';
import { familyFromAppleIdentifier, familyFromProductName, modelFromDeviceTree, modelFromDmi, parseRegQuery, readMachineModel } from './machine-model.ts';

describe('machine model', () => {
    test('macOS: the device tree name loses the configuration behind it', () => {
        expect(familyFromProductName('MacBook Pro (16-inch, Nov 2024)\0')).toBe('MacBook Pro');
        expect(familyFromProductName('MacBook Air (13-inch, M2, 2022)')).toBe('MacBook Air');
        expect(familyFromProductName('Mac mini')).toBe('Mac mini');
        expect(familyFromProductName('  ')).toBeNull();
    });

    test('macOS: an Intel identifier carries its family, an Apple Silicon one does not', () => {
        expect(familyFromAppleIdentifier('MacBookPro16,1')).toBe('MacBook Pro');
        expect(familyFromAppleIdentifier('MacBookAir9,1')).toBe('MacBook Air');
        expect(familyFromAppleIdentifier('MacBook10,1')).toBe('MacBook');
        expect(familyFromAppleIdentifier('Macmini8,1\n')).toBe('Mac mini');
        expect(familyFromAppleIdentifier('MacPro7,1')).toBe('Mac Pro');
        expect(familyFromAppleIdentifier('iMacPro1,1')).toBe('iMac Pro');
        expect(familyFromAppleIdentifier('iMac20,2')).toBe('iMac');
        // Every Apple Silicon Mac answers like this, whatever it is; the device tree is what names those.
        expect(familyFromAppleIdentifier('Mac16,5')).toBeNull();
        expect(familyFromAppleIdentifier('')).toBeNull();
    });

    test('SMBIOS: the product name is the model, and Lenovo keeps it in the version field', () => {
        expect(modelFromDmi({ vendor: 'Dell Inc.', productName: 'XPS 15 9500', version: 'Not Specified' })).toBe('XPS 15 9500');
        expect(modelFromDmi({ vendor: 'LENOVO', productName: '20XW00ABMH', version: 'ThinkPad X1 Carbon Gen 9' })).toBe('ThinkPad X1 Carbon Gen 9');
        // Lenovo with nothing in the version field still beats saying nothing at all.
        expect(modelFromDmi({ vendor: 'LENOVO', productName: '20XW00ABMH', version: 'None' })).toBe('20XW00ABMH');
        expect(modelFromDmi({ vendor: 'ASUSTeK COMPUTER INC.', productName: 'System Product Name', family: 'ROG Strix' })).toBe('ROG Strix');
        expect(modelFromDmi({ vendor: 'QEMU', productName: 'Standard PC (Q35 + ICH9, 2009)' })).toBe('Standard PC (Q35 + ICH9, 2009)');
    });

    test('SMBIOS: firmware that filled nothing in says nothing', () => {
        expect(modelFromDmi({})).toBeNull();
        expect(modelFromDmi({ vendor: null, productName: 'To Be Filled By O.E.M.\n', version: 'Default string\n', family: '\n' })).toBeNull();
        expect(modelFromDmi({ productName: 'System Product Name', version: 'System Version' })).toBeNull();
    });

    test('a device tree names the board and drops its revision', () => {
        expect(modelFromDeviceTree('Raspberry Pi 4 Model B Rev 1.4\0')).toBe('Raspberry Pi 4 Model B');
        expect(modelFromDeviceTree('Raspberry Pi 5 Model B Rev 1.0')).toBe('Raspberry Pi 5 Model B');
        expect(modelFromDeviceTree('\0')).toBeNull();
    });

    test('reg query is read value by value', () => {
        const output = [
            '',
            'HKEY_LOCAL_MACHINE\\HARDWARE\\DESCRIPTION\\System\\BIOS',
            '    SystemManufacturer    REG_SZ    Dell Inc.',
            '    SystemProductName    REG_SZ    XPS 15 9500',
            '    SystemFamily    REG_SZ    XPS',
            '    BiosMajorRelease    REG_DWORD    0x1',
            ''
        ].join('\r\n');

        expect(parseRegQuery(output)).toEqual({
            SystemManufacturer: 'Dell Inc.',
            SystemProductName: 'XPS 15 9500',
            SystemFamily: 'XPS',
            BiosMajorRelease: '0x1'
        });
    });

    test('a platform nothing here can read answers nothing rather than throwing', async () => {
        expect(await readMachineModel('freebsd')).toBeNull();
    });

    test('the model of the machine running this test is a name or nothing, never an error', async () => {
        const model = await readMachineModel();
        expect(model === null || (model.length > 0 && model.trim() === model)).toBe(true);
    });
});
