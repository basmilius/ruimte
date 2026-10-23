/*
 * The PowerShell script that moves one item to the Recycle Bin on Windows, and the exit codes it answers with.
 * The script only says why through its code: the sentence a person reads is written in `trash.ts`, and a
 * path never has to cross PowerShell's stderr, which writes in the console's code page.
 */
export const RecycleBinExit = {
    moved: 0,
    notFixed: 10,
    recycleBinOff: 11,
    tooLarge: 12,
    linkedFolder: 13,
    inUse: 14,
    shellFailed: 15,
    canceled: 16
} as const;

/*
 * C# rather than the VB `FileSystem` class, whose `OnlyErrorDialogs` still lets the shell show an error
 * dialog that nobody may be there to answer, and which with its confirmations off deletes for good whatever
 * the Recycle Bin will not take. So every case the shell would delete for good is refused before it is
 * called: a drive that is not fixed (a network share, a USB stick, a SUBST drive), a bin that is off, and an
 * item larger than the bin. A linked folder (a junction, a directory symbolic link, a mount point) is refused
 * as well, since whether the shell moves the link or walks into it is not known; a linked folder deeper in a
 * folder is not counted, as it is not the folder's own. `FOF_WANTNUKEWARNING` stays as the last guard: should
 * the shell still mean to delete for good, it asks instead, and with nobody there the time limit in
 * `trash.ts` ends the process with the item left where it was.
 */
export const RECYCLE_BIN_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

public static class RuimteRecycleBin
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct FileOperation
    {
        public IntPtr Window;
        public uint Function;
        public string From;
        public string To;
        public ushort Flags;
        [MarshalAs(UnmanagedType.Bool)] public bool Aborted;
        public IntPtr Mappings;
        public string Title;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct FindData
    {
        public uint Attributes;
        public uint CreatedLow, CreatedHigh, AccessedLow, AccessedHigh, WrittenLow, WrittenHigh;
        public uint SizeHigh;
        public uint SizeLow;
        public uint Tag;
        public uint Reserved;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string ShortName;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHFileOperationW(ref FileOperation operation);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr FindFirstFileW(string name, out FindData data);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool FindNextFileW(IntPtr handle, out FindData data);

    [DllImport("kernel32.dll")]
    static extern bool FindClose(IntPtr handle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetVolumePathNameW(string path, StringBuilder volume, uint length);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetDriveTypeW(string root);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetVolumeNameForVolumeMountPointW(string root, StringBuilder name, uint length);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetDiskFreeSpaceExW(string root, out ulong available, out ulong total, out ulong free);

    const int Moved = ${RecycleBinExit.moved}, NotFixed = ${RecycleBinExit.notFixed}, RecycleBinOff = ${RecycleBinExit.recycleBinOff}, TooLarge = ${RecycleBinExit.tooLarge};
    const int LinkedFolder = ${RecycleBinExit.linkedFolder}, InUse = ${RecycleBinExit.inUse}, ShellFailed = ${RecycleBinExit.shellFailed}, Canceled = ${RecycleBinExit.canceled};
    const uint DriveFixed = 3;
    const uint AttributeDirectory = 0x10, AttributeReparsePoint = 0x400;
    // Junctions, symbolic links and mount points carry this bit; a OneDrive placeholder does not, and is walked.
    const uint NameSurrogate = 0x20000000;
    const uint Delete = 3;
    const ushort Silent = 0x4, NoConfirmation = 0x10, AllowUndo = 0x40, NoErrorUi = 0x400, WantNukeWarning = 0x4000;
    const string PolicyKey = @"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer";
    const string VolumeKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\";
    static readonly IntPtr NoHandle = new IntPtr(-1);

    public static int Run(string target)
    {
        // The layout of FileOperation is the 64-bit one; a 32-bit PowerShell packs it differently.
        if (IntPtr.Size != 8)
        {
            Console.Error.WriteLine("A 32-bit PowerShell cannot call the shell here");
            return ShellFailed;
        }
        StringBuilder volume = new StringBuilder(1024);
        if (!GetVolumePathNameW(target, volume, (uint)volume.Capacity))
        {
            return NotFixed;
        }
        string root = volume.ToString();
        if (GetDriveTypeW(root) != DriveFixed)
        {
            return NotFixed;
        }
        FindData entry;
        IntPtr handle = FindFirstFileW(Long(target), out entry);
        if (handle == NoHandle)
        {
            throw new Win32Exception();
        }
        FindClose(handle);
        if ((entry.Attributes & AttributeDirectory) != 0 && IsLink(entry))
        {
            return LinkedFolder;
        }
        long capacity = Capacity(root);
        if (capacity < 0)
        {
            return RecycleBinOff;
        }
        if (Size(target, entry, capacity) > capacity)
        {
            return TooLarge;
        }
        return Recycle(target);
    }

    static int Recycle(string target)
    {
        FileOperation operation = new FileOperation();
        operation.Function = Delete;
        operation.From = target + "\0\0";
        operation.Flags = (ushort)(Silent | NoConfirmation | AllowUndo | NoErrorUi | WantNukeWarning);
        int result = SHFileOperationW(ref operation);
        // ERROR_SHARING_VIOLATION and ERROR_LOCK_VIOLATION: another program holds the file.
        if (result == 0x20 || result == 0x21)
        {
            return InUse;
        }
        if (operation.Aborted)
        {
            return Canceled;
        }
        if (result != 0)
        {
            Console.Error.WriteLine("The shell answered 0x" + result.ToString("X"));
            return ShellFailed;
        }
        return Moved;
    }

    /* The bytes the Recycle Bin of this drive holds, or -1 when nothing goes there. */
    static long Capacity(string root)
    {
        if (Policy("NoRecycleFiles") == 1)
        {
            return -1;
        }
        ulong available, total, free;
        if (!GetDiskFreeSpaceExW(root, out available, out total, out free))
        {
            throw new Win32Exception();
        }
        // A SUBST drive has no volume of its own, and the shell deletes from it for good.
        StringBuilder name = new StringBuilder(64);
        if (!GetVolumeNameForVolumeMountPointW(root, name, (uint)name.Capacity))
        {
            return -1;
        }
        // Without a size of its own the bin is taken to be small: a refusal can be tried again, a deletion cannot.
        long capacity = (long)(total / 20);
        string id = name.ToString();
        int open = id.IndexOf('{');
        int close = id.IndexOf('}');
        if (open >= 0 && close > open)
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(VolumeKey + id.Substring(open, close - open + 1)))
            {
                if (key != null)
                {
                    if (Number(key.GetValue("NukeOnDelete")) == 1)
                    {
                        return -1;
                    }
                    int megabytes = Number(key.GetValue("MaxCapacity"));
                    if (megabytes >= 0)
                    {
                        capacity = (long)megabytes * 1024 * 1024;
                    }
                }
            }
        }
        int percent = Policy("RecycleBinSize");
        if (percent >= 0)
        {
            capacity = Math.Min(capacity, (long)(total / 100 * (ulong)percent));
        }
        return capacity;
    }

    static int Policy(string name)
    {
        foreach (RegistryKey hive in new RegistryKey[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            using (RegistryKey key = hive.OpenSubKey(PolicyKey))
            {
                if (key != null)
                {
                    int value = Number(key.GetValue(name));
                    if (value >= 0)
                    {
                        return value;
                    }
                }
            }
        }
        return -1;
    }

    static int Number(object value)
    {
        return value is int ? (int)value : -1;
    }

    static bool IsLink(FindData entry)
    {
        return (entry.Attributes & AttributeReparsePoint) != 0 && (entry.Tag & NameSurrogate) != 0;
    }

    static long Length(FindData entry)
    {
        return ((long)entry.SizeHigh << 32) | entry.SizeLow;
    }

    static string Long(string path)
    {
        // The prefix lifts the length limit and also turns off the conversion of '/', so that happens here.
        string native = path.Replace('/', '\\');
        return native.StartsWith(@"\\?\") ? native : @"\\?\" + native;
    }

    /* Stops counting once past the limit, so a large folder is refused without walking all of it. */
    static long Size(string target, FindData entry, long limit)
    {
        if ((entry.Attributes & AttributeDirectory) == 0)
        {
            return Length(entry);
        }
        long total = 0;
        Stack<string> folders = new Stack<string>();
        folders.Push(Long(target));
        while (folders.Count > 0)
        {
            string folder = folders.Pop();
            FindData child;
            IntPtr handle = FindFirstFileW(folder + @"\*", out child);
            if (handle == NoHandle)
            {
                throw new Win32Exception();
            }
            try
            {
                do
                {
                    if (child.Name == "." || child.Name == "..")
                    {
                        continue;
                    }
                    if ((child.Attributes & AttributeDirectory) == 0)
                    {
                        total += Length(child);
                    }
                    else if (!IsLink(child))
                    {
                        folders.Push(folder + @"\" + child.Name);
                    }
                    if (total > limit)
                    {
                        return total;
                    }
                } while (FindNextFileW(handle, out child));
            }
            finally
            {
                FindClose(handle);
            }
        }
        return total;
    }
}
`;

/*
 * Compiling the helper takes seconds, so it is compiled once per version of its source, into the
 * assembly `trash.ts` names, and loaded from there after. The draft carries the process id, so two
 * deletes at once never write one file, and the first to finish keeps its name.
 * The path comes from `RUIMTE_TRASH_PATH`, never from the script text, so no quoting can break it.
 * An error is written by hand, in UTF-8: under `-EncodedCommand` PowerShell writes its own as CLIXML,
 * and the console's code page would garble a message Windows wrote in another language.
 */
export const RECYCLE_BIN_SCRIPT = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
    'try {',
    '    $assembly = $env:RUIMTE_RECYCLE_BIN_ASSEMBLY',
    '    if (-not (Test-Path -LiteralPath $assembly)) {',
    '        $draft = $assembly -replace \'\\.dll$\', ".$PID.dll"',
    '        Add-Type -LiteralPath $env:RUIMTE_RECYCLE_BIN_SOURCE -OutputAssembly $draft',
    '        try { [System.IO.File]::Move($draft, $assembly) } catch { Remove-Item -LiteralPath $draft -Force -ErrorAction SilentlyContinue }',
    '    }',
    "    $helper = Add-Type -LiteralPath $assembly -PassThru | Where-Object { $_.Name -eq 'RuimteRecycleBin' }",
    '    $code = $helper::Run($env:RUIMTE_TRASH_PATH)',
    '} catch {',
    '    $failure = $_.Exception',
    '    while ($failure.InnerException) { $failure = $failure.InnerException }',
    '    [Console]::Error.WriteLine($failure.Message)',
    '    exit 1',
    '}',
    'exit $code'
].join('\n');

/* `-EncodedCommand` takes the script as UTF-16 in base64, so its quotes and lines need no escaping on the command line. */
export function recycleBinCommand(): string[] {
    return ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(RECYCLE_BIN_SCRIPT, 'utf16le').toString('base64')];
}
