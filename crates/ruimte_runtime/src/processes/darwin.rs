use std::{
    ffi::{CString, c_void},
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::Context;

use super::sampler::{
    CommandLine, MachineCounters, ProcessSampler, RawProcess, RawSample, parse_nul_command_line,
};

const PROC_PIDTBSDINFO: i32 = 3;
const PROC_PIDT_SHORTBSDINFO: i32 = 13;
const RUSAGE_INFO_V4: i32 = 4;
const HOST_CPU_LOAD_INFO: i32 = 3;
const HOST_VM_INFO64: i32 = 4;
const HOST_VM_INFO64_COUNT: u32 = 38;
const CTL_KERN: i32 = 1;
const KERN_PROCARGS2: i32 = 49;
const MAX_COMMAND_LINE_BYTES: usize = 1024 * 1024;

unsafe extern "C" {
    fn proc_listallpids(buffer: *mut c_void, buffersize: i32) -> i32;
    fn proc_pidinfo(pid: i32, flavor: i32, arg: u64, buffer: *mut c_void, buffersize: i32) -> i32;
    fn proc_pidpath(pid: i32, buffer: *mut c_void, buffersize: u32) -> i32;
    fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut c_void) -> i32;
    fn mach_timebase_info(info: *mut MachTimebaseInfo) -> i32;
    fn mach_absolute_time() -> u64;
    fn mach_continuous_time() -> u64;
    fn mach_host_self() -> u32;
    fn host_statistics(host: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
    fn host_statistics64(host: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
}

#[repr(C)]
#[derive(Default)]
struct ProcBsdInfo {
    flags: u32,
    status: u32,
    xstatus: u32,
    pid: u32,
    ppid: u32,
    uid: u32,
    gid: u32,
    ruid: u32,
    rgid: u32,
    svuid: u32,
    svgid: u32,
    rfu_1: u32,
    comm: [libc::c_char; 16],
    name: [libc::c_char; 32],
    nfiles: u32,
    pgid: u32,
    pjobc: u32,
    e_tdev: u32,
    e_tpgid: u32,
    nice: i32,
    start_tvsec: u64,
    start_tvusec: u64,
}

#[repr(C)]
struct MachTimebaseInfo {
    numer: u32,
    denom: u32,
}

pub struct DarwinSampler {
    home: PathBuf,
    numer: u64,
    denom: u64,
    host: u32,
    page_size: u64,
}

impl DarwinSampler {
    pub fn new(home: PathBuf) -> Self {
        let mut timebase = MachTimebaseInfo { numer: 1, denom: 1 };
        unsafe { mach_timebase_info(&mut timebase) };
        Self {
            home,
            numer: u64::from(timebase.numer.max(1)),
            denom: u64::from(timebase.denom.max(1)),
            host: unsafe { mach_host_self() },
            page_size: unsafe { libc::sysconf(libc::_SC_PAGESIZE) }.max(1) as u64,
        }
    }

    fn pids() -> Vec<i32> {
        let mut pids = vec![0i32; 4096];
        loop {
            let count = unsafe {
                proc_listallpids(
                    pids.as_mut_ptr().cast(),
                    std::mem::size_of_val(pids.as_slice()) as i32,
                )
            };
            if count <= 0 {
                return Vec::new();
            }
            if (count as usize) < pids.len() {
                pids.truncate(count as usize);
                return pids;
            }
            pids.resize(pids.len() * 2, 0);
        }
    }

    fn read_process(&self, pid: i32) -> anyhow::Result<RawProcess> {
        let mut info = ProcBsdInfo::default();
        let size = std::mem::size_of::<ProcBsdInfo>() as i32;
        if unsafe {
            proc_pidinfo(
                pid,
                PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut ProcBsdInfo).cast(),
                size,
            )
        } != size
        {
            return Self::read_foreign(pid);
        }

        let mut usage = [0u8; 512];
        let readable =
            unsafe { proc_pid_rusage(pid, RUSAGE_INFO_V4, usage.as_mut_ptr().cast()) } == 0;
        let mut path = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let path_length = unsafe { proc_pidpath(pid, path.as_mut_ptr().cast(), path.len() as u32) };
        let path = (path_length > 0).then(|| {
            let bytes = &path[..path_length as usize];
            let end = bytes
                .iter()
                .position(|byte| *byte == 0)
                .unwrap_or(bytes.len());
            String::from_utf8_lossy(&bytes[..end]).into_owned()
        });
        let name_bytes = if info.name[0] == 0 {
            &info.comm[..]
        } else {
            &info.name[..]
        };
        let name = c_chars(name_bytes);
        Ok(RawProcess {
            pid: info.pid,
            ppid: info.ppid,
            uid: info.uid,
            start_time: info.start_tvsec * 1_000_000 + info.start_tvusec,
            name,
            path,
            readable,
            cpu_ns: readable.then(|| {
                self.ticks_to_ns(read_u64(&usage, 16).saturating_add(read_u64(&usage, 24)))
            }),
            memory: readable.then(|| read_u64(&usage, 72)),
            disk_read: readable.then(|| read_u64(&usage, 144)),
            disk_write: readable.then(|| read_u64(&usage, 152)),
        })
    }

    fn read_foreign(pid: i32) -> anyhow::Result<RawProcess> {
        let mut info = [0u8; 64];
        let size = info.len() as i32;
        if unsafe {
            proc_pidinfo(
                pid,
                PROC_PIDT_SHORTBSDINFO,
                0,
                info.as_mut_ptr().cast(),
                size,
            )
        } != size
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(RawProcess {
            pid: read_u32(&info, 0),
            ppid: read_u32(&info, 4),
            uid: read_u32(&info, 36),
            start_time: 0,
            name: c_string(&info[16..32]),
            path: None,
            readable: false,
            cpu_ns: None,
            memory: None,
            disk_read: None,
            disk_write: None,
        })
    }

    fn ticks_to_ns(&self, ticks: u64) -> u64 {
        ticks.saturating_mul(self.numer) / self.denom
    }

    fn machine(&self) -> MachineCounters {
        let mut cpu = [0u32; 4];
        let mut cpu_count = cpu.len() as u32;
        let cpu_read = unsafe {
            host_statistics(
                self.host,
                HOST_CPU_LOAD_INFO,
                cpu.as_mut_ptr().cast(),
                &mut cpu_count,
            )
        } == 0;
        let cpu_busy = cpu_read.then(|| u64::from(cpu[0]) + u64::from(cpu[1]) + u64::from(cpu[3]));
        let cpu_total = cpu_busy.map(|busy| busy + u64::from(cpu[2]));

        let mut vm = [0u32; HOST_VM_INFO64_COUNT as usize];
        let mut vm_count = HOST_VM_INFO64_COUNT;
        let vm_read = unsafe {
            host_statistics64(
                self.host,
                HOST_VM_INFO64,
                vm.as_mut_ptr().cast(),
                &mut vm_count,
            )
        } == 0;
        let memory_used = vm_read.then(|| {
            let pages = vm[35].saturating_sub(vm[22]) as u64 + u64::from(vm[3]) + u64::from(vm[32]);
            pages.saturating_mul(self.page_size)
        });
        let (disk_free, disk_total) = statvfs(&self.home).unwrap_or((None, None));
        MachineCounters {
            cores: std::thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(1),
            cpu_busy,
            cpu_total,
            memory_used,
            memory_total: sysctl_u64("hw.memsize").unwrap_or(0),
            disk_free,
            disk_total,
        }
    }
}

impl ProcessSampler for DarwinSampler {
    fn sample(&self) -> anyhow::Result<RawSample> {
        let awake_ticks = unsafe { mach_absolute_time() };
        let continuous_ticks = unsafe { mach_continuous_time() };
        Ok(RawSample {
            at: now_ms(),
            awake_ms: self.ticks_to_ns(awake_ticks) / 1_000_000,
            asleep_ms: self.ticks_to_ns(continuous_ticks.saturating_sub(awake_ticks)) / 1_000_000,
            processes: Self::pids()
                .into_iter()
                .filter(|pid| *pid > 0)
                .filter_map(|pid| self.read_process(pid).ok())
                .collect(),
            machine: self.machine(),
        })
    }

    fn inspect(&self, pid: u32) -> anyhow::Result<Option<(u64, u32)>> {
        match self.read_process(pid as i32) {
            Ok(process) if process.start_time != 0 => Ok(Some((process.start_time, process.uid))),
            Ok(_) => Ok(None),
            Err(error)
                if error.downcast_ref::<std::io::Error>().is_some_and(|error| {
                    matches!(error.raw_os_error(), Some(libc::ESRCH | libc::EINVAL))
                }) =>
            {
                Ok(None)
            }
            Err(error) => Err(error).context("inspect process"),
        }
    }

    fn command_line(&self, pid: u32) -> Option<CommandLine> {
        let mut mib = [CTL_KERN, KERN_PROCARGS2, pid as i32];
        let mut size = 0usize;
        if unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                mib.len() as u32,
                std::ptr::null_mut(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        } != 0
            || !(4..=MAX_COMMAND_LINE_BYTES).contains(&size)
        {
            return None;
        }
        let mut bytes = vec![0u8; size];
        if unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                mib.len() as u32,
                bytes.as_mut_ptr().cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        } != 0
        {
            return None;
        }
        bytes.truncate(size);
        let argc = i32::from_ne_bytes(bytes.get(..4)?.try_into().ok()?);
        if argc < 0 {
            return None;
        }
        let mut offset = 4;
        while offset < bytes.len() && bytes[offset] != 0 {
            offset += 1;
        }
        while offset < bytes.len() && bytes[offset] == 0 {
            offset += 1;
        }
        Some(parse_nul_command_line(
            &bytes[offset..],
            Some(argc as usize),
        ))
    }
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_ne_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("counter offset"),
    )
}

fn read_u64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_ne_bytes(
        bytes[offset..offset + 8]
            .try_into()
            .expect("counter offset"),
    )
}

fn c_string(bytes: &[u8]) -> String {
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

fn c_chars(bytes: &[libc::c_char]) -> String {
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    let bytes = &bytes[..end];
    String::from_utf8_lossy(unsafe {
        std::slice::from_raw_parts(bytes.as_ptr().cast::<u8>(), bytes.len())
    })
    .into_owned()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn sysctl_u64(name: &str) -> anyhow::Result<u64> {
    let name = CString::new(name)?;
    let mut value = 0u64;
    let mut length = std::mem::size_of::<u64>();
    if unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            (&mut value as *mut u64).cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    } != 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(value)
}

fn statvfs(path: &std::path::Path) -> anyhow::Result<(Option<u64>, Option<u64>)> {
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(path.as_os_str().as_bytes())?;
    let mut stat = std::mem::MaybeUninit::<libc::statfs>::uninit();
    if unsafe { libc::statfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let stat = unsafe { stat.assume_init() };
    Ok((
        Some(stat.f_bavail * stat.f_bsize as u64),
        Some(stat.f_blocks * stat.f_bsize as u64),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sdk_struct_layout_matches_proc_bsdinfo() {
        assert_eq!(std::mem::size_of::<ProcBsdInfo>(), 136);
        let info = std::mem::MaybeUninit::<ProcBsdInfo>::uninit();
        let base = info.as_ptr() as usize;
        assert_eq!(
            unsafe { std::ptr::addr_of!((*info.as_ptr()).ppid) } as usize - base,
            16
        );
        assert_eq!(
            unsafe { std::ptr::addr_of!((*info.as_ptr()).start_tvsec) } as usize - base,
            120
        );
    }
}
