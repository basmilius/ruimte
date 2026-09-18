use std::{
    collections::HashMap,
    ffi::{CStr, CString, c_char, c_void},
    net::{IpAddr, Ipv6Addr, SocketAddr},
    ptr,
    sync::mpsc,
    time::Duration,
};

use anyhow::{Context, Result, bail};
use block2::{Block, RcBlock};
use idevice::{
    IdeviceError, ReadWrite, RemoteXpcClient,
    rsd::{RsdHandshake, RsdService},
    xpc::{Dictionary, XPCObject as RemoteXpcObject},
};
use tokio::{net::TcpStream, process::Command, time::sleep};
use uuid::Uuid;

type XpcObject = *mut c_void;
type DispatchQueue = *mut c_void;

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
}

struct OwnedXpc(XpcObject);

impl OwnedXpc {
    fn new_dictionary() -> Result<Self> {
        let object = unsafe { xpc_dictionary_create(ptr::null(), ptr::null(), 0) };
        (!object.is_null())
            .then_some(Self(object))
            .context("libxpc could not create a dictionary")
    }

    unsafe fn from_owned(object: XpcObject) -> Result<Self> {
        (!object.is_null())
            .then_some(Self(object))
            .context("libxpc returned a null object")
    }

    fn as_ptr(&self) -> XpcObject {
        self.0
    }
}

impl Drop for OwnedXpc {
    fn drop(&mut self) {
        unsafe { xpc_release(self.0) };
    }
}

struct OwnedQueue(DispatchQueue);

impl OwnedQueue {
    fn new() -> Result<Self> {
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
    let device_ip = tunnel.tunnel_ip();
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
    pub fn open(udid: Option<&str>) -> Result<Self> {
        Self::open_with_queue(OwnedQueue::new()?, udid)
    }

    pub fn tunnel_ip(&self) -> IpAddr {
        self.tunnel_ip
    }

    fn open_with_queue(queue: OwnedQueue, udid: Option<&str>) -> Result<Self> {
        let browse_connection = unsafe {
            OwnedXpc::from_owned(xpc_connection_create_mach_service(
                REMOTE_PAIRING_SERVICE.as_ptr(),
                queue.as_ptr(),
                0,
            ))
        }
        .context("could not connect to remotepairingd")?;
        let endpoint = browse_for_endpoint(browse_connection.as_ptr(), queue.as_ptr(), udid)?;
        let device_connection =
            unsafe { OwnedXpc::from_owned(xpc_connection_create_from_endpoint(endpoint.as_ptr())) }
                .context("remotepairingd returned an invalid device endpoint")?;

        let event_handler = RcBlock::new(|_event: XpcObject| {});
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
            unsafe {
                xpc_dictionary_set_value(
                    body.as_ptr(),
                    c"assertionIdentifier".as_ptr(),
                    self.assertion_identifier.as_ptr(),
                );
            }
            if let Ok(message) = request_message("RemotePairing.ReleaseAssertionRequest", &body) {
                let _ = send_message_with_reply(
                    self.device_connection.as_ptr(),
                    self._queue.as_ptr(),
                    &message,
                    "RemotePairing.ReleaseAssertionRequest",
                );
            }
        }
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
        if let Some(endpoint) = unsafe { device_endpoint(event, wanted_udid.as_deref()) } {
            let endpoint = unsafe { xpc_retain(endpoint) };
            let _ = sender.try_send(endpoint as usize);
        }
    });
    unsafe {
        xpc_connection_set_event_handler(connection, &event_handler);
        xpc_connection_activate(connection);
    }

    let body = OwnedXpc::new_dictionary()?;
    unsafe { xpc_dictionary_set_bool(body.as_ptr(), c"currentDevicesOnly".as_ptr(), false) };
    let message = request_message("RemotePairing.BrowseRequest", &body)?;
    let reply_handler = RcBlock::new(|_reply: XpcObject| {});
    unsafe {
        xpc_connection_send_message_with_reply(connection, message.as_ptr(), queue, &reply_handler);
    }

    let endpoint = receiver
        .recv_timeout(REPLY_TIMEOUT)
        .context("remotepairingd reported no matching wireless device")?;
    unsafe { OwnedXpc::from_owned(endpoint as XpcObject) }
}

unsafe fn device_endpoint(event: XpcObject, wanted_udid: Option<&CStr>) -> Option<XpcObject> {
    if event.is_null() {
        return None;
    }
    let value = unsafe { xpc_dictionary_get_value(event, c"value".as_ptr()) };
    if value.is_null() {
        return None;
    }
    let found = unsafe { xpc_dictionary_get_value(value, c"deviceFound".as_ptr()) };
    if found.is_null() {
        return None;
    }
    let zero = unsafe { xpc_dictionary_get_value(found, c"_0".as_ptr()) };
    if zero.is_null() {
        return None;
    }
    let info = unsafe { xpc_dictionary_get_value(zero, c"deviceInfo".as_ptr()) };
    if info.is_null() {
        return None;
    }
    if let Some(wanted) = wanted_udid {
        let actual = unsafe { xpc_dictionary_get_string(info, c"udid".as_ptr()) };
        if actual.is_null() || unsafe { CStr::from_ptr(actual) } != wanted {
            return None;
        }
    }
    let endpoint = unsafe { xpc_dictionary_get_value(info, c"endpoint".as_ptr()) };
    (!endpoint.is_null()).then_some(endpoint)
}

fn ensure_paired(connection: XpcObject, queue: DispatchQueue) -> Result<()> {
    let body = OwnedXpc::new_dictionary()?;
    unsafe { xpc_dictionary_set_bool(body.as_ptr(), c"requireNonInteractive".as_ptr(), true) };
    let reply = send_request(
        connection,
        queue,
        "RemotePairing.InitiatePairingCommand",
        &body,
    )?;
    let error = unsafe { xpc_dictionary_get_value(reply.as_ptr(), c"error".as_ptr()) };
    if error.is_null() {
        return Ok(());
    }
    let code = unsafe { xpc_dictionary_get_int64(error, c"code".as_ptr()) };
    if code == ALREADY_PAIRED {
        Ok(())
    } else {
        bail!("remotepairingd could not pair the device (error {code})")
    }
}

fn create_assertion(connection: XpcObject, queue: DispatchQueue) -> Result<(OwnedXpc, IpAddr)> {
    let body = OwnedXpc::new_dictionary()?;
    unsafe { xpc_dictionary_set_int64(body.as_ptr(), c"flags".as_ptr(), 0) };
    let reply = send_request(
        connection,
        queue,
        "RemotePairing.CreateAssertionCommand",
        &body,
    )?;
    let response = unsafe { xpc_dictionary_get_value(reply.as_ptr(), c"response".as_ptr()) };
    if response.is_null() {
        bail!("remotepairingd returned no tunnel assertion");
    }
    let identifier = unsafe { xpc_dictionary_get_value(response, c"assertionIdentifier".as_ptr()) };
    let info = unsafe { xpc_dictionary_get_value(response, c"info".as_ptr()) };
    let address = unsafe { xpc_dictionary_get_string(info, c"tunnelIPAddress".as_ptr()) };
    if identifier.is_null() || address.is_null() {
        bail!("remotepairingd returned an incomplete tunnel assertion");
    }
    let address = unsafe { CStr::from_ptr(address) }
        .to_str()
        .context("remotepairingd returned a malformed tunnel address")?
        .parse::<Ipv6Addr>()
        .context("remotepairingd returned an invalid tunnel address")?;
    let identifier = unsafe { OwnedXpc::from_owned(xpc_retain(identifier)) }?;
    Ok((identifier, IpAddr::V6(address)))
}

fn send_request(
    connection: XpcObject,
    queue: DispatchQueue,
    request_type: &str,
    body: &OwnedXpc,
) -> Result<OwnedXpc> {
    let message = request_message(request_type, body)?;
    send_message_with_reply(connection, queue, &message, request_type)
}

fn send_message_with_reply(
    connection: XpcObject,
    queue: DispatchQueue,
    message: &OwnedXpc,
    request_type: &str,
) -> Result<OwnedXpc> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let reply_handler = RcBlock::new(move |reply: XpcObject| {
        if !reply.is_null() {
            let reply = unsafe { xpc_retain(reply) };
            let _ = sender.try_send(reply as usize);
        }
    });
    unsafe {
        xpc_connection_send_message_with_reply(connection, message.as_ptr(), queue, &reply_handler);
    }
    let reply = receiver
        .recv_timeout(REPLY_TIMEOUT)
        .with_context(|| format!("timed out waiting for {request_type}"))?;
    unsafe { OwnedXpc::from_owned(reply as XpcObject) }
}

fn request_message(request_type: &str, body: &OwnedXpc) -> Result<OwnedXpc> {
    let request_type = CString::new(request_type).context("invalid XPC request name")?;
    let message = OwnedXpc::new_dictionary()?;
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
        let fields = line.split(',').collect::<Vec<_>>();
        let Some(first) = fields.first().copied() else {
            continue;
        };
        if !first.starts_with("tcp4 ") && !first.starts_with("tcp6 ") {
            is_remoted = first
                .rsplit_once('.')
                .is_some_and(|(name, pid)| name == "remoted" && pid.parse::<u32>().is_ok());
            continue;
        }
        if !is_remoted || fields.get(2).copied() != Some("Established") {
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
    let mut properties = Dictionary::new();
    properties.insert(
        "RemoteXPCVersionFlags".into(),
        RemoteXpcObject::UInt64(0x0100_0000_0000_0006),
    );
    properties.insert(
        "SensitivePropertiesVisible".into(),
        RemoteXpcObject::Bool(true),
    );
    let mut message = Dictionary::new();
    message.insert(
        "MessageType".into(),
        RemoteXpcObject::String("Handshake".into()),
    );
    message.insert(
        "MessagingProtocolVersion".into(),
        RemoteXpcObject::UInt64(7),
    );
    message.insert("UUID".into(), RemoteXpcObject::Uuid(handshake_uuid));
    message.insert("Properties".into(), RemoteXpcObject::Dictionary(properties));
    message.insert(
        "Services".into(),
        RemoteXpcObject::Dictionary(Dictionary::new()),
    );
    client
        .send_object(RemoteXpcObject::Dictionary(message), false)
        .await?;
    let data = client.recv_root().await?;
    parse_rsd_handshake(data)
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
    use super::parse_nettop_ports;
    use std::net::IpAddr;

    #[test]
    fn finds_only_remoted_connections_to_the_tunnel() {
        let output = "remoted.342,,,\ntcp6 fd9c::2.49800<->fd9c::1.57726,utun4,Established\nother.99,,,\ntcp6 fd9c::2.49801<->fd9c::1.57727,utun4,Established\nremoted.342,,,\ntcp6 fd9c::2.49802<->fd9c::1.57728,utun4,Closed\n";
        assert_eq!(
            parse_nettop_ports(output, "fd9c::1".parse::<IpAddr>().unwrap()),
            vec![57726]
        );
    }
}
