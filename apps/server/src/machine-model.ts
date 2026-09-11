import { readFile } from 'node:fs/promises';

/*
 * What the hardware this daemon runs on is called, in the words a person would use for it: "MacBook
 * Pro", "Mac mini", "XPS 15 9500", "Raspberry Pi 4 Model B". The client puts it in the row for the
 * machine you are on ("This MacBook Pro"), which falls back to "This machine", so every reader here
 * may answer null and none of them may throw: a model nobody can read is not a failure.
 */

/* Firmware fills these in when the board maker left the field empty; they are worse than nothing. */
const PLACEHOLDERS = new Set([
    'system product name',
    'system manufacturer',
    'system version',
    'system name',
    'to be filled by o.e.m.',
    'to be filled by o.e.m',
    'default string',
    'not specified',
    'not applicable',
    'no enclosure',
    'product name',
    'filled by oem',
    'unknown',
    'none',
    'oem',
    'n/a',
    'invalid',
    'x.x'
]);

/* A field is usable when firmware really wrote something in it. Trailing NULs come from raw sysfs. */
const usable = (value: string | null | undefined): string | null => {
    const text = (value ?? '').replace(/\0/g, '').trim();
    if (text === '' || PLACEHOLDERS.has(text.toLowerCase())) {
        return null;
    }
    return text;
};

/*
 * Apple's marketing name, as macOS reports it in the device tree: "MacBook Pro (16-inch, Nov 2024)".
 * The parenthetical is the exact configuration, which nobody calls their laptop, so the family is
 * what is left in front of it.
 */
export const familyFromProductName = (raw: string): string | null => usable(raw.split(' (')[0] ?? '');

/* The identifier prefixes Apple ships, longest first: "MacBookPro" has to win from "MacBook". */
const APPLE_FAMILIES: [string, string][] = [
    ['MacBookPro', 'MacBook Pro'],
    ['MacBookAir', 'MacBook Air'],
    ['MacBook', 'MacBook'],
    ['MacStudio', 'Mac Studio'],
    ['Macmini', 'Mac mini'],
    ['MacPro', 'Mac Pro'],
    ['iMacPro', 'iMac Pro'],
    ['iMac', 'iMac'],
    ['Xserve', 'Xserve']
];

/*
 * The family behind a `hw.model` identifier such as "MacBookPro18,3". Only Intel Macs name their
 * family there; every Apple Silicon Mac answers "Mac16,5", which says nothing a person would use,
 * so this returns null for those and the device tree above is what covers them.
 */
export const familyFromAppleIdentifier = (raw: string): string | null => {
    const identifier = usable(raw);
    if (identifier === null) {
        return null;
    }
    for (const [prefix, family] of APPLE_FAMILIES) {
        if (identifier.startsWith(prefix) && /^\d/.test(identifier.slice(prefix.length))) {
            return family;
        }
    }
    return null;
};

export interface DmiFields {
    vendor?: string | null;
    productName?: string | null;
    version?: string | null;
    family?: string | null;
}

/*
 * The model out of the SMBIOS fields, which Linux exposes as files and Windows as registry values.
 * Lenovo is the exception every tool that reads these carries: its product name is an order code
 * ("20XW00ABMH") and the readable name sits in the version field.
 */
export const modelFromDmi = (fields: DmiFields): string | null => {
    const vendor = usable(fields.vendor);
    const version = usable(fields.version);
    if (vendor !== null && /^lenovo/i.test(vendor) && version !== null) {
        return version;
    }
    return usable(fields.productName) ?? usable(fields.family) ?? version;
};

/*
 * A board that carries a device tree instead of SMBIOS names itself in one line: "Raspberry Pi 4
 * Model B Rev 1.4". The revision is the board's, not the machine's, so it goes.
 */
export const modelFromDeviceTree = (raw: string): string | null => usable(raw.replace(/\0/g, '').replace(/\s+Rev\s+[\d.]+\s*$/i, ''));

/* `reg query` prints `<name><tab or spaces><type><tab or spaces><value>`, one value per line. */
export const parseRegQuery = (output: string): Record<string, string> => {
    const values: Record<string, string> = {};
    for (const line of output.split(/\r?\n/)) {
        const match = /^\s+(\S+)\s+REG_[A-Z_]+\s+(.*)$/.exec(line);
        if (match) {
            values[match[1]!] = match[2]!.trim();
        }
    }
    return values;
};

/* A command that answers on stdout, or null: a binary that is missing, hangs or fails is no answer. */
const run = async (command: string[]): Promise<string | null> => {
    try {
        const proc = Bun.spawn(command, { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
        const timer = setTimeout(() => proc.kill(), 2000);
        const output = await new Response(proc.stdout).text();
        const code = await proc.exited;
        clearTimeout(timer);
        return code === 0 ? output : null;
    } catch {
        return null;
    }
};

const readText = async (path: string): Promise<string | null> => {
    try {
        return await readFile(path, 'utf8');
    } catch {
        return null;
    }
};

/* The base64 blob `ioreg -a` prints for a data property, which is the name plus a trailing NUL. */
const decodeIoregData = (plist: string): string | null => {
    const match = /<key>product-name<\/key>\s*<data>\s*([A-Za-z0-9+/=\s]+?)\s*<\/data>/.exec(plist);
    if (!match) {
        return null;
    }
    try {
        return Buffer.from(match[1]!.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
        return null;
    }
};

const readDarwinModel = async (): Promise<string | null> => {
    const plist = await run(['ioreg', '-arc', 'IOPlatformDevice', '-k', 'product-name']);
    const productName = plist === null ? null : decodeIoregData(plist);
    if (productName !== null) {
        const family = familyFromProductName(productName);
        if (family !== null) {
            return family;
        }
    }
    const identifier = await run(['sysctl', '-n', 'hw.model']);
    return identifier === null ? null : familyFromAppleIdentifier(identifier);
};

const DMI_DIR = '/sys/devices/virtual/dmi/id';

const readLinuxModel = async (): Promise<string | null> => {
    const [vendor, productName, version, family] = await Promise.all([
        readText(`${DMI_DIR}/sys_vendor`),
        readText(`${DMI_DIR}/product_name`),
        readText(`${DMI_DIR}/product_version`),
        readText(`${DMI_DIR}/product_family`)
    ]);
    const dmi = modelFromDmi({ vendor, productName, version, family });
    if (dmi !== null) {
        return dmi;
    }
    // A board without SMBIOS: a Pi, a phone, most of ARM. Unreadable DMI lands here as well.
    const tree = await readText('/proc/device-tree/model');
    return tree === null ? null : modelFromDeviceTree(tree);
};

const BIOS_KEY = 'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS';

/*
 * Windows keeps the same SMBIOS fields under one registry key. `reg query` answers in milliseconds
 * where a `Get-CimInstance` through PowerShell would cost a second of the daemon's start.
 */
const readWindowsModel = async (): Promise<string | null> => {
    const output = await run(['reg', 'query', BIOS_KEY]);
    if (output === null) {
        return null;
    }
    const values = parseRegQuery(output);
    return modelFromDmi({
        vendor: values.SystemManufacturer,
        productName: values.SystemProductName,
        version: values.SystemVersion,
        family: values.SystemFamily
    });
};

/* Read once when the daemon starts: the hardware under it does not change while it runs. */
export const readMachineModel = async (platform: string = process.platform): Promise<string | null> => {
    switch (platform) {
        case 'darwin':
            return await readDarwinModel();
        case 'linux':
            return await readLinuxModel();
        case 'win32':
            return await readWindowsModel();
        default:
            return null;
    }
};
