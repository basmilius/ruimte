use std::collections::HashMap;
use std::ffi::{CStr, CString, c_char, c_void};
use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::ptr;
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use block2::{Block, RcBlock};
use idevice::rsd::{RsdHandshake, RsdService};
use idevice::xpc::{Dictionary, XPCObject as RemoteXpcObject};
use idevice::{IdeviceError, ReadWrite, RemoteXpcClient};
use tokio::net::TcpStream;
use tokio::process::Command;
use tokio::time::sleep;
use uuid::Uuid;

type XpcObject = *mut c_void;
type DispatchQueue = *mut c_void;

#[repr(C)]
struct XpcType {
    _opaque: [u8; 0],
}

const REMOTE_PAIRING_SERVICE: &CStr = c"com.apple.CoreDevice.remotepairingd";
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);
const ALREADY_PAIRED: i64 = 1002;
const RSD_CONNECT_ATTEMPTS: usize = 5;
const RSD_CONNECT_RETRY_DELAY: Duration = Duration::from_millis(500);

#[link(name = "System")]
unsafe extern "C" {
    fn dispatch_queue_create(label: *const c_char, attribute: *const c_void) -> DispatchQueue;
    fn dispatch_release(object: DispatchQueue);

    fn xpc_connection_create_mach_service(
        name: *const c_char,
        queue: DispatchQueue,
        flags: u64,
    ) -> XpcObject;
    fn xpc_connection_create_from_endpoint(endpoint: XpcObject) -> XpcObject;
    fn xpc_connection_set_event_handler(connection: XpcObject, handler: &Block<dyn Fn(XpcObject)>);
    fn xpc_connection_activate(connection: XpcObject);
    fn xpc_connection_cancel(connection: XpcObject);
    fn xpc_connection_send_message_with_reply(
        connection: XpcObject,
        message: XpcObject,
        queue: DispatchQueue,
        handler: &Block<dyn Fn(XpcObject)>,
    );

    fn xpc_dictionary_create(
        keys: *const *const c_char,
        values: *const XpcObject,
        count: usize,
    ) -> XpcObject;
    fn xpc_dictionary_set_string(dictionary: XpcObject, key: *const c_char, value: *const c_char);
    fn xpc_dictionary_set_bool(dictionary: XpcObject, key: *const c_char, value: bool);
    fn xpc_dictionary_set_int64(dictionary: XpcObject, key: *const c_char, value: i64);
    fn xpc_dictionary_set_value(dictionary: XpcObject, key: *const c_char, value: XpcObject);
    fn xpc_dictionary_get_value(dictionary: XpcObject, key: *const c_char) -> XpcObject;
    fn xpc_dictionary_get_string(dictionary: XpcObject, key: *const c_char) -> *const c_char;
    fn xpc_dictionary_get_int64(dictionary: XpcObject, key: *const c_char) -> i64;

    fn xpc_retain(object: XpcObject) -> XpcObject;
    fn xpc_release(object: XpcObject);
    fn xpc_get_type(object: XpcObject) -> *const XpcType;

    #[link_name = "_xpc_type_dictionary"]
    static XPC_TYPE_DICTIONARY: XpcType;
}

struct OwnedXpc(XpcObject);

impl OwnedXpc {
    fn new_dictionary() -> Result<Self> {
        // SAFETY: with a count of zero libxpc reads neither array, and the new dictionary is ours to release.
        let object = unsafe { xpc_dictionary_create(ptr::null(), ptr::null(), 0) };
        (!object.is_null())
            .then_some(Self(object))
            .context("libxpc could not create a dictionary")
    }

    /// Safety: `object` is null or an XPC object whose one reference the caller hands over.
    unsafe fn from_owned(object: XpcObject) -> Result<Self> {
        (!object.is_null())
            .then_some(Self(object))
            .context("libxpc returned a null object")
    }

    /// Takes a reference of its own on an object libxpc only lends to a handler.
    ///
    /// Safety: `object` is a live XPC object.
    unsafe fn retain(object: XpcObject) -> Result<Self> {
        // SAFETY: the caller vouches that `object` is live, and xpc_retain hands back the reference it adds.
        unsafe { Self::from_owned(xpc_retain(object)) }
    }

    fn as_ptr(&self) -> XpcObject {
        self.0
    }
}

// SAFETY: libxpc objects are reference counted atomically and may be released on any thread.
unsafe impl Send for OwnedXpc {}

impl Drop for OwnedXpc {
    fn drop(&mut self) {
        // SAFETY: the pointer is non-null by construction, and this is the one release of the reference we own.
        unsafe { xpc_release(self.0) };
    }
}

struct OwnedQueue(DispatchQueue);

impl OwnedQueue {
    fn new() -> Result<Self> {
        // SAFETY: the label is a static C string, and a null attribute asks for a serial queue.
        let queue =
            unsafe { dispatch_queue_create(c"app.ruimte.ios-device-bridge".as_ptr(), ptr::null()) };
        (!queue.is_null())
            .then_some(Self(queue))
            .context("could not create the remotepairingd dispatch queue")
    }

    fn as_ptr(&self) -> DispatchQueue {
        self.0
    }
}

impl Drop for OwnedQueue {
    fn drop(&mut self) {
        // SAFETY: the queue is non-null by construction, and this is the one release of the reference we own.
        unsafe { dispatch_release(self.0) };
    }
}

pub struct NativeRemotedTunnel {
    browse_connection: OwnedXpc,
    device_connection: OwnedXpc,
    assertion_identifier: OwnedXpc,
    tunnel_ip: IpAddr,
    _queue: OwnedQueue,
}

pub struct NativeRsdSession {
    pub device_ip: IpAddr,
    pub host_ip: IpAddr,
    pub handshake: RsdHandshake,
    pub tunnel: NativeRemotedTunnel,
}

pub async fn connect_rsd(udid: Option<&str>) -> Result<NativeRsdSession> {
    let tunnel = NativeRemotedTunnel::open(udid)?;
    let device_ip = tunnel.tunnel_ip;
    let handshake_uuid = host_remoted_uuid().await?;
    let mut last_error: Option<anyhow::Error> = None;

    for attempt in 0..RSD_CONNECT_ATTEMPTS {
        if attempt > 0 {
            sleep(RSD_CONNECT_RETRY_DELAY).await;
        }
        for port in find_rsd_ports(device_ip).await? {
            let stream = match TcpStream::connect(SocketAddr::new(device_ip, port)).await {
                Ok(stream) => stream,
                Err(error) => {
                    last_error = Some(error.into());
                    continue;
                }
            };
            let host_ip = stream
                .local_addr()
                .context("could not read the remoted tunnel's local address")?
                .ip();
            match rsd_handshake_with_uuid(stream, handshake_uuid).await {
                Ok(handshake) => {
                    return Ok(NativeRsdSession {
                        device_ip,
                        host_ip,
                        handshake,
                        tunnel,
                    });
                }
                Err(error) => last_error = Some(error.into()),
            }
        }
    }

    match last_error {
        Some(error) => Err(error).context("the wireless RSD handshake failed"),
        None => bail!("could not find remoted's RSD connection to {device_ip}"),
    }
}

impl NativeRemotedTunnel {
    fn open(udid: Option<&str>) -> Result<Self> {
        let queue = OwnedQueue::new()?;
        // SAFETY: the service name is a static C string, the queue outlives the connection in `Self`, and the
        // new connection's reference is ours.
        let browse_connection = unsafe {
            OwnedXpc::from_owned(xpc_connection_create_mach_service(
                REMOTE_PAIRING_SERVICE.as_ptr(),
                queue.as_ptr(),
                0,
            ))
        }
        .context("could not connect to remotepairingd")?;
        let endpoint = browse_for_endpoint(browse_connection.as_ptr(), queue.as_ptr(), udid)?;
        // SAFETY: `endpoint` holds its own reference for the call, and the new connection's reference is ours.
        let device_connection =
            unsafe { OwnedXpc::from_owned(xpc_connection_create_from_endpoint(endpoint.as_ptr())) }
                .context("remotepairingd returned an invalid device endpoint")?;

        let event_handler = RcBlock::new(|_event: XpcObject| {});
        // SAFETY: the connection is live, and libxpc copies the handler block before this one drops.
        unsafe {
            xpc_connection_set_event_handler(device_connection.as_ptr(), &event_handler);
            xpc_connection_activate(device_connection.as_ptr());
        }

        ensure_paired(device_connection.as_ptr(), queue.as_ptr())?;
        let (assertion_identifier, tunnel_ip) =
            create_assertion(device_connection.as_ptr(), queue.as_ptr())?;
        Ok(Self {
            browse_connection,
            device_connection,
            assertion_identifier,
            tunnel_ip,
            _queue: queue,
        })
    }
}

impl Drop for NativeRemotedTunnel {
    fn drop(&mut self) {
        if let Ok(body) = OwnedXpc::new_dictionary() {
            // SAFETY: both objects are ours and live, the key is a static C string, and the dictionary retains
            // the value.
            unsafe {
                xpc_dictionary_set_value(
                    body.as_ptr(),
                    c"assertionIdentifier".as_ptr(),
                    self.assertion_identifier.as_ptr(),
                );
            }
            let _ = send_request(
                self.device_connection.as_ptr(),
                self._queue.as_ptr(),
                "RemotePairing.ReleaseAssertionRequest",
                &body,
            );
        }
        // SAFETY: both connections are ours and still hold their references; their fields release them after.
        unsafe {
            xpc_connection_cancel(self.device_connection.as_ptr());
            xpc_connection_cancel(self.browse_connection.as_ptr());
        }
    }
}

fn browse_for_endpoint(
    connection: XpcObject,
    queue: DispatchQueue,
    udid: Option<&str>,
) -> Result<OwnedXpc> {
    let wanted_udid = udid
        .map(CString::new)
        .transpose()
        .context("invalid device UDID")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let event_handler = RcBlock::new(move |event: XpcObject| {
        // SAFETY: libxpc lends the event for the handler's run, and the endpoint inside it is retained before
        // the handler returns.
        if let Some(endpoint) = unsafe { device_endpoint(event, wanted_udid.as_deref()) }
            // SAFETY: as above, the endpoint lives as long as the event that holds it.
            && let Ok(endpoint) = unsafe { OwnedXpc::retain(endpoint) }
        {
            let _ = sender.try_send(endpoint);
        }
    });
    // SAFETY: the caller's connection is live, and libxpc copies the handler block before this one drops.
    unsafe {
        xpc_connection_set_event_handler(connection, &event_handler);
        xpc_connection_activate(connection);
    }

    let body = OwnedXpc::new_dictionary()?;
    // SAFETY: the dictionary is ours and live, and the key is a static C string.
    unsafe { xpc_dictionary_set_bool(body.as_ptr(), c"currentDevicesOnly".as_ptr(), false) };
    let message = request_message("RemotePairing.BrowseRequest", &body)?;
    let reply_handler = RcBlock::new(|_reply: XpcObject| {});
    // SAFETY: the connection, message and queue are live, and libxpc retains the message and copies the block.
    unsafe {
        xpc_connection_send_message_with_reply(connection, message.as_ptr(), queue, &reply_handler);
    }

    receiver
        .recv_timeout(REPLY_TIMEOUT)
        .context("remotepairingd reported no matching wireless device")
}

/// Safety: `event` is null or a live XPC object; the endpoint handed back lives as long as it does.
unsafe fn device_endpoint(event: XpcObject, wanted_udid: Option<&CStr>) -> Option<XpcObject> {
    if !is_dictionary(event) {
        return None;
    }
    // SAFETY: `event` is a live dictionary, and each child is borrowed from the one above it.
    let info = unsafe {
        let value = child_dictionary(event, c"value")?;
        let found = child_dictionary(value, c"deviceFound")?;
        let zero = child_dictionary(found, c"_0")?;
        child_dictionary(zero, c"deviceInfo")?
    };
    if let Some(wanted) = wanted_udid {
        // SAFETY: `info` is a live dictionary, and the string it hands back lives as long as it does.
        let actual = unsafe { xpc_dictionary_get_string(info, c"udid".as_ptr()) };
        // SAFETY: a non-null string from libxpc is NUL-terminated and outlives the comparison.
        if actual.is_null() || unsafe { CStr::from_ptr(actual) } != wanted {
            return None;
        }
    }
    // SAFETY: `info` is a live dictionary, and the key is a static C string.
    let endpoint = unsafe { xpc_dictionary_get_value(info, c"endpoint".as_ptr()) };
    (!endpoint.is_null()).then_some(endpoint)
}

fn ensure_paired(connection: XpcObject, queue: DispatchQueue) -> Result<()> {
    let body = OwnedXpc::new_dictionary()?;
    // SAFETY: the dictionary is ours and live, and the key is a static C string.
    unsafe { xpc_dictionary_set_bool(body.as_ptr(), c"requireNonInteractive".as_ptr(), false) };
    let reply = send_request(
        connection,
        queue,
        "RemotePairing.InitiatePairingCommand",
        &body,
    )?;
    // SAFETY: the reply is ours and live.
    let Some(error) = (unsafe { child_dictionary(reply.as_ptr(), c"error") }) else {
        return Ok(());
    };
    // SAFETY: `error` is a dictionary borrowed from the reply, which is still alive.
    let code = unsafe { xpc_dictionary_get_int64(error, c"code".as_ptr()) };

    if code != ALREADY_PAIRED {
        bail!("remotepairingd could not pair the device (error {code})");
    }

    Ok(())
}

fn create_assertion(connection: XpcObject, queue: DispatchQueue) -> Result<(OwnedXpc, IpAddr)> {
    let body = OwnedXpc::new_dictionary()?;
    // SAFETY: the dictionary is ours and live, and the key is a static C string.
    unsafe { xpc_dictionary_set_int64(body.as_ptr(), c"flags".as_ptr(), 0) };
    let reply = send_request(
        connection,
        queue,
        "RemotePairing.CreateAssertionCommand",
        &body,
    )?;
    // SAFETY: the reply is a live dictionary, ours to the end of this function, so all borrowed from it below
    // lives as long.
    let response = unsafe { child_dictionary(reply.as_ptr(), c"response") }
        .context("remotepairingd returned no tunnel assertion")?;
    // SAFETY: `response` is a live dictionary borrowed from the reply.
    let identifier = unsafe { xpc_dictionary_get_value(response, c"assertionIdentifier".as_ptr()) };
    // SAFETY: `response` and the `info` inside it are live dictionaries borrowed from the reply.
    let address = unsafe { child_dictionary(response, c"info") }
        // SAFETY: as above.
        .map(|info| unsafe { xpc_dictionary_get_string(info, c"tunnelIPAddress".as_ptr()) })
        .unwrap_or(ptr::null());
    if identifier.is_null() || address.is_null() {
        bail!("remotepairingd returned an incomplete tunnel assertion");
    }
    // SAFETY: a non-null string from libxpc is NUL-terminated and lives as long as the reply.
    let address = unsafe { CStr::from_ptr(address) }
        .to_str()
        .context("remotepairingd returned a malformed tunnel address")?
        .parse::<Ipv6Addr>()
        .context("remotepairingd returned an invalid tunnel address")?;
    // SAFETY: `identifier` is non-null and borrowed from the live reply.
    let identifier = unsafe { OwnedXpc::retain(identifier) }?;
    Ok((identifier, IpAddr::V6(address)))
}

fn send_request(
    connection: XpcObject,
    queue: DispatchQueue,
    request_type: &str,
    body: &OwnedXpc,
) -> Result<OwnedXpc> {
    let message = request_message(request_type, body)?;
    let (sender, receiver) = mpsc::sync_channel(1);
    let reply_handler = RcBlock::new(move |reply: XpcObject| {
        // Anything but a dictionary is an XPC error, such as the connection going away.
        let reply = is_dictionary(reply)
            // SAFETY: libxpc lends the reply for the handler's run, and it is a live dictionary.
            .then(|| unsafe { OwnedXpc::retain(reply) })
            .and_then(Result::ok);
        let _ = sender.try_send(reply);
    });
    // SAFETY: the connection, message and queue are live, and libxpc retains the message and copies the block.
    unsafe {
        xpc_connection_send_message_with_reply(connection, message.as_ptr(), queue, &reply_handler);
    }
    receiver
        .recv_timeout(REPLY_TIMEOUT)
        .with_context(|| format!("timed out waiting for {request_type}"))?
        .with_context(|| {
            format!("remotepairingd dropped the connection before answering {request_type}")
        })
}

fn is_dictionary(object: XpcObject) -> bool {
    !object.is_null()
        && ptr::eq(
            // SAFETY: every caller passes a live XPC object, checked for null above.
            unsafe { xpc_get_type(object) },
            &raw const XPC_TYPE_DICTIONARY,
        )
}

/// The value under `key`, or `None` when it is missing or not a dictionary.
///
/// Safety: `dictionary` is a live XPC dictionary; the child handed back lives as long as it does.
unsafe fn child_dictionary(dictionary: XpcObject, key: &CStr) -> Option<XpcObject> {
    // SAFETY: the caller vouches for the dictionary, and `key` is NUL-terminated.
    let value = unsafe { xpc_dictionary_get_value(dictionary, key.as_ptr()) };
    is_dictionary(value).then_some(value)
}

fn request_message(request_type: &str, body: &OwnedXpc) -> Result<OwnedXpc> {
    let request_type = CString::new(request_type).context("invalid XPC request name")?;
    let message = OwnedXpc::new_dictionary()?;
    // SAFETY: both dictionaries are live, the strings are NUL-terminated and outlive the call, and libxpc copies
    // the string and retains the body.
    unsafe {
        xpc_dictionary_set_string(
            message.as_ptr(),
            c"mangledTypeName".as_ptr(),
            request_type.as_ptr(),
        );
        xpc_dictionary_set_value(message.as_ptr(), c"value".as_ptr(), body.as_ptr());
    }
    Ok(message)
}

async fn host_remoted_uuid() -> Result<Uuid> {
    let output = Command::new("/usr/libexec/remotectl")
        .arg("dumpstate")
        .output()
        .await
        .context("could not inspect the local remoted identity")?;
    if !output.status.success() {
        bail!("remotectl could not inspect the local remoted identity");
    }
    let output = String::from_utf8_lossy(&output.stdout);
    let mut local_device = false;
    for line in output.lines() {
        if line.trim() == "Local device" {
            local_device = true;
            continue;
        }
        if local_device {
            if let Some(value) = line.trim().strip_prefix("UUID: ") {
                return value
                    .parse()
                    .context("remotectl returned an invalid local UUID");
            }
            if !line.starts_with(char::is_whitespace) {
                local_device = false;
            }
        }
    }
    bail!("remotectl returned no local remoted UUID")
}

async fn find_rsd_ports(tunnel_ip: IpAddr) -> Result<Vec<u16>> {
    let output = Command::new("/usr/bin/nettop")
        .args(["-n", "-x", "-L", "1", "-m", "tcp", "-J", "interface,state"])
        .output()
        .await
        .context("could not inspect remoted's tunnel connection")?;
    if !output.status.success() {
        bail!("nettop could not inspect remoted's tunnel connection");
    }
    Ok(parse_nettop_ports(
        &String::from_utf8_lossy(&output.stdout),
        tunnel_ip,
    ))
}

fn parse_nettop_ports(output: &str, tunnel_ip: IpAddr) -> Vec<u16> {
    let mut is_remoted = false;
    let mut ports = Vec::new();
    for line in output.lines() {
        let mut fields = line.split(',');
        let first = fields.next().unwrap_or_default();

        if !first.starts_with("tcp4 ") && !first.starts_with("tcp6 ") {
            is_remoted = first
                .rsplit_once('.')
                .is_some_and(|(name, pid)| name == "remoted" && pid.parse::<u32>().is_ok());
            continue;
        }

        if !is_remoted || fields.nth(1) != Some("Established") {
            continue;
        }

        let Some((_, foreign)) = first.split_once("<->") else {
            continue;
        };
        let Some((address, port)) = split_nettop_endpoint(foreign) else {
            continue;
        };
        if address.parse::<IpAddr>().ok() == Some(tunnel_ip) {
            ports.push(port);
        }
    }
    ports
}

fn split_nettop_endpoint(endpoint: &str) -> Option<(&str, u16)> {
    let separator = if endpoint.matches(':').count() == 1 {
        ':'
    } else {
        '.'
    };
    let (address, port) = endpoint.rsplit_once(separator)?;
    let address = address.split('%').next()?;
    Some((address, port.parse().ok()?))
}

async fn rsd_handshake_with_uuid(
    socket: impl ReadWrite,
    handshake_uuid: Uuid,
) -> Result<RsdHandshake, IdeviceError> {
    let mut client = RemoteXpcClient::new(socket).await?;
    client.do_handshake().await?;

    let properties = Dictionary::from_iter([
        (
            "RemoteXPCVersionFlags".into(),
            RemoteXpcObject::UInt64(0x0100_0000_0000_0006),
        ),
        (
            "SensitivePropertiesVisible".into(),
            RemoteXpcObject::Bool(true),
        ),
    ]);
    let message = Dictionary::from_iter([
        (
            "MessageType".into(),
            RemoteXpcObject::String("Handshake".into()),
        ),
        (
            "MessagingProtocolVersion".into(),
            RemoteXpcObject::UInt64(7),
        ),
        ("UUID".into(), RemoteXpcObject::Uuid(handshake_uuid)),
        ("Properties".into(), RemoteXpcObject::Dictionary(properties)),
        (
            "Services".into(),
            RemoteXpcObject::Dictionary(Dictionary::new()),
        ),
    ]);

    client
        .send_object(RemoteXpcObject::Dictionary(message), false)
        .await?;

    parse_rsd_handshake(client.recv_root().await?)
}

fn parse_rsd_handshake(data: plist::Value) -> Result<RsdHandshake, IdeviceError> {
    let dictionary = data.as_dictionary().ok_or_else(|| {
        IdeviceError::UnexpectedResponse("RSD handshake was not a dictionary".into())
    })?;
    let advertised = dictionary
        .get("Services")
        .and_then(plist::Value::as_dictionary)
        .ok_or_else(|| IdeviceError::UnexpectedResponse("missing RSD services".into()))?;
    let mut services = HashMap::new();
    for (name, value) in advertised {
        let Some(service) = value.as_dictionary() else {
            continue;
        };
        let Some(entitlement) = service.get("Entitlement").and_then(plist::Value::as_string) else {
            continue;
        };
        let Some(port) = service
            .get("Port")
            .and_then(plist::Value::as_string)
            .and_then(|port| port.parse::<u16>().ok())
        else {
            continue;
        };
        let properties = service
            .get("Properties")
            .and_then(plist::Value::as_dictionary);
        let uses_remote_xpc = properties
            .and_then(|value| value.get("UsesRemoteXPC"))
            .and_then(plist::Value::as_boolean)
            .unwrap_or(false);
        let features = properties
            .and_then(|value| value.get("Features"))
            .and_then(plist::Value::as_array)
            .map(|features| {
                features
                    .iter()
                    .filter_map(plist::Value::as_string)
                    .map(str::to_owned)
                    .collect()
            });
        let service_version = properties
            .and_then(|value| value.get("ServiceVersion"))
            .and_then(plist::Value::as_signed_integer);
        services.insert(
            name.clone(),
            RsdService {
                entitlement: entitlement.to_owned(),
                port,
                uses_remote_xpc,
                features,
                service_version,
            },
        );
    }
    let protocol_version = dictionary
        .get("MessagingProtocolVersion")
        .and_then(plist::Value::as_signed_integer)
        .ok_or_else(|| IdeviceError::UnexpectedResponse("missing RSD protocol version".into()))?
        as usize;
    let uuid = dictionary
        .get("UUID")
        .and_then(plist::Value::as_string)
        .ok_or_else(|| IdeviceError::UnexpectedResponse("missing RSD UUID".into()))?
        .to_owned();
    let properties = dictionary
        .get("Properties")
        .and_then(plist::Value::as_dictionary)
        .ok_or_else(|| IdeviceError::UnexpectedResponse("missing RSD properties".into()))?
        .iter()
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    Ok(RsdHandshake {
        services,
        protocol_version,
        properties,
        uuid,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_dictionaries_as_dictionaries() {
        let parent = OwnedXpc::new_dictionary().unwrap();
        let child = OwnedXpc::new_dictionary().unwrap();

        // SAFETY: both dictionaries are ours and live, and every string is a static C string.
        unsafe {
            xpc_dictionary_set_value(parent.as_ptr(), c"child".as_ptr(), child.as_ptr());
            xpc_dictionary_set_string(parent.as_ptr(), c"text".as_ptr(), c"value".as_ptr());
        }

        assert!(is_dictionary(parent.as_ptr()));
        assert!(!is_dictionary(std::ptr::null_mut()));
        // SAFETY: `parent` is ours and live for every lookup below.
        let lookups = unsafe {
            [
                child_dictionary(parent.as_ptr(), c"child"),
                child_dictionary(parent.as_ptr(), c"text"),
                child_dictionary(parent.as_ptr(), c"missing"),
            ]
        };
        assert_eq!(lookups, [Some(child.as_ptr()), None, None]);
    }

    #[test]
    fn finds_only_remoted_connections_to_the_tunnel() {
        let output = "remoted.342,,,\ntcp6 fd9c::2.49800<->fd9c::1.57726,utun4,Established\nother.99,,,\ntcp6 fd9c::2.49801<->fd9c::1.57727,utun4,Established\nremoted.342,,,\ntcp6 fd9c::2.49802<->fd9c::1.57728,utun4,Closed\n";
        assert_eq!(
            parse_nettop_ports(output, "fd9c::1".parse::<IpAddr>().unwrap()),
            vec![57726]
        );
    }
}
