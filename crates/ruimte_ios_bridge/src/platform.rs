use std::{fs::File, os::fd::FromRawFd, time::Duration};

use anyhow::{Context, Result, bail};
use idevice::{
    IdeviceService, ReadWrite, RsdService,
    core_device::{
        ButtonState, CallInfoBlob, DisplayServiceClient, HevcDepacketizer, IndigoHidClient,
        OrientationServiceClient, RotationDirection, RtpPacket, TOUCHSCREEN_STATE_CONTACT,
        TOUCHSCREEN_STATE_RELEASE, TouchscreenContact, UniversalHidServiceClient,
        build_screen_audio_offer, build_screen_video_offer, build_start_audio_parameters,
        build_start_video_parameters,
    },
    core_device_proxy::CoreDeviceProxy,
    rsd::RsdHandshake,
    tcp::handle::UdpSocketHandle,
    usbmuxd::{UsbmuxdAddr, UsbmuxdConnection},
};
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::UdpSocket;

#[path = "native_remoted.rs"]
mod native_remoted;

use native_remoted::{NativeRemotedTunnel, connect_rsd};

const MAGIC: [u8; 8] = [0x52, 0x44, 0x45, 0x56, 0x01, 0x00, 0x00, 0x00];
const CLIENT_SUPPORTED_FEATURES: u64 = 140;
const CONTROL_MESSAGE_BYTES_MAXIMUM: usize = 64 * 1024;
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;
const PHYSICAL_STARTUP_TIMEOUT: Duration = Duration::from_secs(18);

use crate::{ProbeOptions, ProbeResult, ProbeTransport};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum DeviceInput {
    Pointer {
        phase: PointerPhase,
        x: f64,
        y: f64,
    },
    MultiPointer {
        phase: PointerPhase,
        first: InputPoint,
        second: InputPoint,
    },
    Scroll,
    Button {
        button: DeviceButton,
    },
    Rotate {
        direction: Rotation,
    },
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum PointerPhase {
    Down,
    Move,
    Up,
}

#[derive(Clone, Copy, Deserialize)]
struct InputPoint {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum DeviceButton {
    Home,
    SwipeHome,
    AppSwitcher,
    Lock,
    Siri,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Rotation {
    Left,
    Right,
}

enum ControlMessage {
    Input(DeviceInput),
    Stop,
    Ignored,
}

enum MediaUdp {
    SoftwareTunnel(UdpSocketHandle),
    Kernel {
        socket: UdpSocket,
        buffer: Box<[u8]>,
    },
}

enum MediaDatagram<'a> {
    Owned(Vec<u8>),
    Borrowed(&'a [u8]),
}

impl AsRef<[u8]> for MediaDatagram<'_> {
    fn as_ref(&self) -> &[u8] {
        match self {
            Self::Owned(data) => data,
            Self::Borrowed(data) => data,
        }
    }
}

impl MediaUdp {
    fn kernel(socket: UdpSocket) -> Self {
        Self::Kernel {
            socket,
            buffer: vec![0_u8; 65_535].into_boxed_slice(),
        }
    }

    async fn recv(&mut self) -> Result<MediaDatagram<'_>> {
        match self {
            Self::SoftwareTunnel(socket) => socket
                .recv()
                .await
                .map(|datagram| MediaDatagram::Owned(datagram.data))
                .context("the display stream closed"),
            Self::Kernel { socket, buffer } => {
                let length = socket
                    .recv(buffer)
                    .await
                    .context("the wireless display stream closed")?;
                Ok(MediaDatagram::Borrowed(&buffer[..length]))
            }
        }
    }

    fn local_port(&self) -> Result<u16> {
        match self {
            Self::SoftwareTunnel(socket) => Ok(socket.local_port()),
            Self::Kernel { socket, .. } => Ok(socket.local_addr()?.port()),
        }
    }
}

struct ScreenMediaStream {
    client: DisplayServiceClient<Box<dyn ReadWrite>>,
    input: Option<DeviceInputClients>,
    _audio_udp: MediaUdp,
    video_udp: MediaUdp,
    _native_tunnel: Option<NativeRemotedTunnel>,
    transport: &'static str,
}

struct StartedPhysicalStream {
    session: ScreenMediaStream,
    first_frame: Vec<u8>,
    depacketizer: HevcDepacketizer,
    access_unit: Vec<u8>,
}

struct DeviceInputClients {
    touch: UniversalHidServiceClient<Box<dyn ReadWrite>>,
    buttons: IndigoHidClient<Box<dyn ReadWrite>>,
    orientation: OrientationServiceClient<Box<dyn ReadWrite>>,
}

struct DeviceServices {
    display: DisplayServiceClient<Box<dyn ReadWrite>>,
    input: Option<DeviceInputClients>,
}

struct ProtocolWriter<W = tokio::fs::File> {
    output: W,
}

impl ProtocolWriter<tokio::fs::File> {
    async fn open() -> Result<Self> {
        let fd = std::env::var("RUIMTE_DEVICE_HELPER_PROTOCOL_FD")
            .context("missing protocol descriptor")?
            .parse::<i32>()
            .context("invalid protocol descriptor")?;
        // The daemon gives this process sole ownership of the inherited protocol descriptor.
        let file = unsafe { File::from_raw_fd(fd) };
        let mut output = tokio::fs::File::from_std(file);
        output.write_all(&MAGIC).await?;
        Ok(Self { output })
    }
}

impl<W: AsyncWrite + Unpin> ProtocolWriter<W> {
    async fn ready(&mut self) -> Result<()> {
        self.control(1, br#"{"width":1,"height":1}"#).await
    }

    async fn frame(&mut self, sequence: u32, data: &[u8]) -> Result<()> {
        if data.len() > MAX_FRAME_BYTES {
            bail!("encoded frame exceeds the stream limit");
        }
        let payload_len = 12 + data.len();
        self.output.write_u8(2).await?;
        self.output.write_u32(payload_len as u32).await?;
        self.output.write_u32(data.len() as u32).await?;
        self.output.write_u32(sequence).await?;
        self.output.write_u16(1).await?;
        self.output.write_u16(1).await?;
        self.output.write_all(data).await?;
        self.output.flush().await?;
        Ok(())
    }

    async fn announce_first_frame(&mut self, data: &[u8]) -> Result<()> {
        if data.len() > MAX_FRAME_BYTES {
            bail!("encoded frame exceeds the stream limit");
        }
        self.ready().await?;
        self.frame(0, data).await
    }

    async fn error(&mut self, message: &str) -> Result<()> {
        let payload = serde_json::to_vec(&serde_json::json!({
            "code": "physical-device-stream-failed",
            "message": message,
        }))?;
        self.control(3, &payload).await
    }

    async fn control(&mut self, kind: u8, payload: &[u8]) -> Result<()> {
        self.output.write_u8(kind).await?;
        self.output.write_u32(payload.len() as u32).await?;
        self.output.write_all(payload).await?;
        self.output.flush().await?;
        Ok(())
    }
}

pub async fn run_physical_helper(udid: Option<String>) -> Result<()> {
    let mut input = tokio::io::stdin();
    let mut magic = [0_u8; MAGIC.len()];
    input
        .read_exact(&mut magic)
        .await
        .context("the helper handshake ended early")?;
    if magic != MAGIC {
        bail!("invalid helper handshake");
    }
    let mut protocol = ProtocolWriter::open().await?;
    let deadline = tokio::time::Instant::now() + PHYSICAL_STARTUP_TIMEOUT;
    let result = start_physical_ios(udid.as_deref(), deadline).await;
    let mut started = match result {
        Ok(started) => started,
        Err(error) => {
            let _ = protocol
                .error(&format!("The physical iOS stream stopped: {error:#}"))
                .await;
            return Err(error);
        }
    };
    if let Err(error) = protocol.announce_first_frame(&started.first_frame).await {
        let _ = started.session.client.stop_media_stream().await;
        return Err(error);
    }
    stream_physical_ios(started, input, &mut protocol, 1).await
}

pub async fn probe(options: ProbeOptions) -> Result<ProbeResult> {
    let mut session = match options.transport {
        ProbeTransport::Wireless => open_wireless_stream(options.udid.as_deref(), false).await?,
        ProbeTransport::Usb => open_direct_stream(options.udid.as_deref(), false).await?,
    };
    let mut depacketizer = HevcDepacketizer::new();
    let mut access_unit = Vec::new();
    let mut packets = 0_u64;
    let frame = tokio::time::timeout(options.timeout, async {
        loop {
            let datagram = session.video_udp.recv().await?;
            packets += 1;
            if let Some(frame) =
                depacketize_rtp(datagram.as_ref(), &mut depacketizer, &mut access_unit)
            {
                return Ok::<Vec<u8>, anyhow::Error>(frame);
            }
        }
    })
    .await
    .context("no complete HEVC frame arrived before the probe timeout")
    .and_then(|result| result);
    let stopped = session
        .client
        .stop_media_stream()
        .await
        .context("the stream worked, but could not be stopped cleanly");
    let frame = frame?;
    stopped?;
    Ok(ProbeResult {
        transport: session.transport,
        codec: "hevc",
        packets,
        frame_bytes: frame.len(),
    })
}

async fn start_physical_ios(
    udid: Option<&str>,
    deadline: tokio::time::Instant,
) -> Result<StartedPhysicalStream> {
    let mut session = tokio::time::timeout_at(deadline, open_physical_stream(udid))
        .await
        .context("the physical iOS stream did not start before the startup timeout")??;
    let mut depacketizer = HevcDepacketizer::new();
    let mut access_unit = Vec::new();
    let first_frame = tokio::time::timeout_at(deadline, async {
        loop {
            let datagram = session
                .video_udp
                .recv()
                .await
                .context("the display stream closed before its first frame")?;
            if let Some(frame) =
                depacketize_rtp(datagram.as_ref(), &mut depacketizer, &mut access_unit)
            {
                return Ok::<Vec<u8>, anyhow::Error>(frame);
            }
        }
    })
    .await
    .context("no complete HEVC frame arrived before the startup timeout")
    .and_then(|result| result);
    match first_frame {
        Ok(first_frame) => Ok(StartedPhysicalStream {
            session,
            first_frame,
            depacketizer,
            access_unit,
        }),
        Err(error) => {
            let _ = session.client.stop_media_stream().await;
            Err(error)
        }
    }
}

async fn open_physical_stream(udid: Option<&str>) -> Result<ScreenMediaStream> {
    match open_wireless_stream(udid, true).await {
        Ok(session) => Ok(session),
        Err(wireless_error) => match open_direct_stream(udid, true).await {
            Ok(session) => Ok(session),
            Err(direct_error) => {
                bail!(
                    "wireless transport failed ({wireless_error:#}); direct CoreDevice transport failed ({direct_error:#})"
                );
            }
        },
    }
}

async fn stream_physical_ios(
    started: StartedPhysicalStream,
    input: tokio::io::Stdin,
    protocol: &mut ProtocolWriter,
    initial_sequence: u32,
) -> Result<()> {
    let StartedPhysicalStream {
        mut session,
        first_frame: _,
        mut depacketizer,
        mut access_unit,
    } = started;
    let input_clients = match session.input.take() {
        Some(input_clients) => input_clients,
        None => {
            let _ = session.client.stop_media_stream().await;
            bail!("the physical device does not expose its input services");
        }
    };
    let ScreenMediaStream {
        mut client,
        input: _,
        _audio_udp: audio_udp,
        video_udp: mut udp,
        _native_tunnel: native_tunnel,
        transport: _,
    } = session;
    let _stream_lifetime = (audio_udp, native_tunnel);
    let mut controls = Box::pin(handle_control_messages(input, input_clients));
    let mut sequence = initial_sequence;

    let result = loop {
        tokio::select! {
            result = &mut controls => {
                break result;
            },
            datagram = tokio::time::timeout(Duration::from_secs(5), udp.recv()) => {
                let datagram = match datagram {
                    Ok(Ok(datagram)) => datagram,
                    Ok(Err(error)) => break Err(error).context("the display stream closed"),
                    Err(_) => continue,
                };
                if let Err(error) = publish_rtp(datagram.as_ref(), &mut depacketizer, &mut access_unit, &mut sequence, protocol).await {
                    break Err(error);
                }
            }
        }
    };
    let stopped = client
        .stop_media_stream()
        .await
        .map(|_| ())
        .context("could not stop the display stream");
    result.and(stopped)
}

async fn open_direct_stream(udid: Option<&str>, connect_input: bool) -> Result<ScreenMediaStream> {
    let address = UsbmuxdAddr::from_env_var().context("invalid usbmuxd address")?;
    let mut usbmuxd = UsbmuxdConnection::default()
        .await
        .context("could not connect to usbmuxd")?;
    let device = match udid {
        Some(udid) => usbmuxd.get_device(udid).await,
        None => usbmuxd.get_devices().await.and_then(|devices| {
            devices
                .into_iter()
                .next()
                .ok_or(idevice::IdeviceError::DeviceNotFound)
        }),
    }
    .context("the physical device is not connected")?;
    let provider = device.to_provider(address, "ios-device-bridge");
    let proxy = CoreDeviceProxy::connect(&provider)
        .await
        .context("could not open the CoreDevice tunnel")?;
    let rsd_port = proxy.tunnel_info().server_rsd_port;
    let adapter = proxy
        .create_software_tunnel()
        .context("could not create the CoreDevice network adapter")?;
    let mut adapter = adapter.to_async_handle();
    let connection = adapter
        .connect(rsd_port)
        .await
        .context("could not connect to Remote Service Discovery")?;
    let mut handshake = RsdHandshake::new(connection)
        .await
        .context("Remote Service Discovery failed")?;
    let client = DisplayServiceClient::connect_rsd(&mut adapter, &mut handshake)
        .await
        .context("the device does not expose its display service")?;
    let audio_udp = MediaUdp::SoftwareTunnel(
        adapter
            .bind_udp(0)
            .await
            .context("could not bind the audio receiver")?,
    );
    let video_udp = MediaUdp::SoftwareTunnel(
        adapter
            .bind_udp(0)
            .await
            .context("could not bind the video receiver")?,
    );
    let mut stream = negotiate_screen_media(
        DeviceServices {
            display: client,
            input: None,
        },
        audio_udp,
        video_udp,
        adapter.host_ip().to_string(),
        adapter.peer_ip().to_string(),
        None,
        "usbmuxd-coredevice-proxy",
    )
    .await?;
    if connect_input {
        match connect_input_services(&mut adapter, &mut handshake).await {
            Ok(input) => stream.input = Some(input),
            Err(error) => {
                let _ = stream.client.stop_media_stream().await;
                return Err(error);
            }
        }
    }
    Ok(stream)
}

async fn open_wireless_stream(
    udid: Option<&str>,
    connect_input: bool,
) -> Result<ScreenMediaStream> {
    let session = connect_rsd(udid).await?;
    let mut provider = session.device_ip;
    let mut handshake = session.handshake;
    let client = DisplayServiceClient::connect_rsd(&mut provider, &mut handshake)
        .await
        .context("the wireless device does not expose its display service")?;
    let bind_address = match session.host_ip {
        std::net::IpAddr::V4(_) => "0.0.0.0:0",
        std::net::IpAddr::V6(_) => "[::]:0",
    };
    let audio_udp = MediaUdp::kernel(
        UdpSocket::bind(bind_address)
            .await
            .context("could not bind the wireless audio receiver")?,
    );
    let video_udp = MediaUdp::kernel(
        UdpSocket::bind(bind_address)
            .await
            .context("could not bind the wireless video receiver")?,
    );
    let mut stream = negotiate_screen_media(
        DeviceServices {
            display: client,
            input: None,
        },
        audio_udp,
        video_udp,
        session.host_ip.to_string(),
        session.device_ip.to_string(),
        Some(session.tunnel),
        "remotepairingd",
    )
    .await?;
    if connect_input {
        match connect_input_services(&mut provider, &mut handshake).await {
            Ok(input) => stream.input = Some(input),
            Err(error) => {
                let _ = stream.client.stop_media_stream().await;
                return Err(error);
            }
        }
    }
    Ok(stream)
}

async fn publish_rtp(
    data: &[u8],
    depacketizer: &mut HevcDepacketizer,
    access_unit: &mut Vec<u8>,
    sequence: &mut u32,
    protocol: &mut ProtocolWriter,
) -> Result<()> {
    if let Some(frame) = depacketize_rtp(data, depacketizer, access_unit) {
        protocol.frame(*sequence, &frame).await?;
        *sequence = sequence.wrapping_add(1);
    }
    Ok(())
}

fn depacketize_rtp(
    data: &[u8],
    depacketizer: &mut HevcDepacketizer,
    access_unit: &mut Vec<u8>,
) -> Option<Vec<u8>> {
    let packet = RtpPacket::parse(data)?;
    let marker = packet.marker;
    depacketizer.push(packet.sequence_number, packet.timestamp, packet.payload);
    access_unit.extend(depacketizer.take_output());
    (marker && !access_unit.is_empty()).then(|| std::mem::take(access_unit))
}

async fn connect_input_services(
    provider: &mut impl idevice::provider::RsdProvider,
    handshake: &mut RsdHandshake,
) -> Result<DeviceInputClients> {
    let touch = UniversalHidServiceClient::connect_rsd(provider, handshake)
        .await
        .context("the device does not expose its touchscreen service")?;
    let buttons = IndigoHidClient::connect_rsd(provider, handshake)
        .await
        .context("the device does not expose its hardware-button service")?;
    let orientation = OrientationServiceClient::connect_rsd(provider, handshake)
        .await
        .context("the device does not expose its orientation service")?;
    Ok(DeviceInputClients {
        touch,
        buttons,
        orientation,
    })
}

async fn handle_control_messages(
    mut input: tokio::io::Stdin,
    mut clients: DeviceInputClients,
) -> Result<()> {
    loop {
        match read_control_message(&mut input).await? {
            ControlMessage::Input(device_input) => {
                apply_device_input(&mut clients, device_input).await?
            }
            ControlMessage::Stop => return Ok(()),
            ControlMessage::Ignored => {}
        }
    }
}

async fn read_control_message<R: tokio::io::AsyncRead + Unpin>(
    input: &mut R,
) -> Result<ControlMessage> {
    let mut header = [0_u8; 5];
    if input.read_exact(&mut header).await.is_err() {
        return Ok(ControlMessage::Stop);
    }
    let length = u32::from_be_bytes(header[1..5].try_into().unwrap()) as usize;
    if length > CONTROL_MESSAGE_BYTES_MAXIMUM {
        bail!("device input exceeds the control-message limit");
    }
    let mut payload = vec![0_u8; length];
    input
        .read_exact(&mut payload)
        .await
        .context("the device input message ended early")?;
    match header[0] {
        17 => Ok(ControlMessage::Input(
            serde_json::from_slice(&payload).context("the device input message is invalid")?,
        )),
        18 if payload.is_empty() => Ok(ControlMessage::Stop),
        _ => Ok(ControlMessage::Ignored),
    }
}

async fn apply_device_input(clients: &mut DeviceInputClients, input: DeviceInput) -> Result<()> {
    match input {
        DeviceInput::Pointer { phase, x, y } => {
            clients
                .touch
                .send_touchscreen(
                    touch_state(phase),
                    normalized_touch_coordinate(x),
                    normalized_touch_coordinate(y),
                    None,
                )
                .await?;
        }
        DeviceInput::MultiPointer {
            phase,
            first,
            second,
        } => {
            let touching = !matches!(phase, PointerPhase::Up);
            clients
                .touch
                .send_multitouch(
                    &[
                        touchscreen_contact(0, touching, first),
                        touchscreen_contact(1, touching, second),
                    ],
                    None,
                )
                .await?;
        }
        DeviceInput::Scroll => {}
        DeviceInput::Button { button } => match button {
            DeviceButton::Home => press_button(&mut clients.buttons, 0x40, 50).await?,
            DeviceButton::Lock => press_button(&mut clients.buttons, 0x30, 500).await?,
            DeviceButton::Siri => press_button(&mut clients.buttons, 0xCF, 1_000).await?,
            DeviceButton::SwipeHome => system_gesture(&mut clients.touch, false).await?,
            DeviceButton::AppSwitcher => system_gesture(&mut clients.touch, true).await?,
        },
        DeviceInput::Rotate { direction } => {
            clients
                .orientation
                .rotate(match direction {
                    Rotation::Left => RotationDirection::Left,
                    Rotation::Right => RotationDirection::Right,
                })
                .await?;
        }
    }
    Ok(())
}

fn touch_state(phase: PointerPhase) -> u8 {
    match phase {
        PointerPhase::Down | PointerPhase::Move => TOUCHSCREEN_STATE_CONTACT,
        PointerPhase::Up => TOUCHSCREEN_STATE_RELEASE,
    }
}

fn normalized_touch_coordinate(value: f64) -> u16 {
    (value.clamp(0.0, 1.0) * f64::from(u16::MAX)).round() as u16
}

fn touchscreen_contact(identity: u8, touching: bool, point: InputPoint) -> TouchscreenContact {
    TouchscreenContact {
        identity,
        touching,
        x: normalized_touch_coordinate(point.x),
        y: normalized_touch_coordinate(point.y),
    }
}

async fn press_button(
    client: &mut IndigoHidClient<Box<dyn ReadWrite>>,
    usage_code: u64,
    hold_ms: u64,
) -> Result<()> {
    client
        .send_button(0x0C, usage_code, ButtonState::Down)
        .await?;
    tokio::time::sleep(Duration::from_millis(hold_ms)).await;
    client
        .send_button(0x0C, usage_code, ButtonState::Up)
        .await?;
    Ok(())
}

async fn system_gesture(
    client: &mut UniversalHidServiceClient<Box<dyn ReadWrite>>,
    app_switcher: bool,
) -> Result<()> {
    let x = normalized_touch_coordinate(0.5);
    let start_y = normalized_touch_coordinate(0.985);
    let end_y = normalized_touch_coordinate(if app_switcher { 0.58 } else { 0.3 });
    let steps = 12_u32;
    for step in 0..=steps {
        let progress = f64::from(step) / f64::from(steps);
        let y = (f64::from(start_y) + (f64::from(end_y) - f64::from(start_y)) * progress).round()
            as u16;
        client
            .send_touchscreen(TOUCHSCREEN_STATE_CONTACT, x, y, None)
            .await?;
        tokio::time::sleep(Duration::from_millis(8)).await;
    }
    if app_switcher {
        tokio::time::sleep(Duration::from_millis(350)).await;
    }
    client
        .send_touchscreen(TOUCHSCREEN_STATE_RELEASE, x, end_y, None)
        .await?;
    Ok(())
}

async fn negotiate_screen_media(
    mut services: DeviceServices,
    audio_udp: MediaUdp,
    video_udp: MediaUdp,
    receiver_ip: String,
    sender_ip: String,
    native_tunnel: Option<NativeRemotedTunnel>,
    transport: &'static str,
) -> Result<ScreenMediaStream> {
    let call_info = CallInfoBlob {
        call_id: 0,
        client_version: 1,
        device_type: "Mac17,7".into(),
        framework_version: "2205.3.1".into(),
        os_version: "25F71".into(),
        device_name: None,
        audio_device_uid: None,
    };
    let client_session_id = uuid::Uuid::new_v4();
    let audio_call_id = uuid::Uuid::new_v4().to_string().to_uppercase();
    let audio_offer = build_screen_audio_offer(&audio_call_id, &call_info)
        .context("could not negotiate screen audio")?;
    let audio_parameters = build_start_audio_parameters(
        &receiver_ip,
        audio_udp.local_port()?,
        &sender_ip,
        50_000,
        audio_offer,
        CLIENT_SUPPORTED_FEATURES,
        client_session_id,
    );
    services
        .display
        .start_media_stream(audio_parameters)
        .await
        .context("the device refused the screen session")?;

    let video_call_id = uuid::Uuid::new_v4().to_string().to_uppercase();
    let controller_ssrc = uuid::Uuid::new_v4().as_u128() as u32;
    let video_offer = build_screen_video_offer(&video_call_id, &call_info, controller_ssrc)
        .context("could not negotiate screen video")?;
    let video_parameters = build_start_video_parameters(
        &receiver_ip,
        video_udp.local_port()?,
        &sender_ip,
        50_001,
        video_offer,
        CLIENT_SUPPORTED_FEATURES,
        1,
        client_session_id,
    );
    if let Err(error) = services
        .display
        .start_media_stream(video_parameters)
        .await
        .context("the device refused the video stream")
    {
        let _ = services.display.stop_media_stream().await;
        return Err(error);
    }
    Ok(ScreenMediaStream {
        client: services.display,
        input: services.input,
        _audio_udp: audio_udp,
        video_udp,
        _native_tunnel: native_tunnel,
        transport,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        CONTROL_MESSAGE_BYTES_MAXIMUM, DeviceButton, DeviceInput, PointerPhase, ProtocolWriter,
        normalized_touch_coordinate, read_control_message, touch_state,
    };
    use tokio::io::AsyncReadExt;

    #[test]
    fn device_input_matches_the_daemon_protocol() {
        let pointer: DeviceInput = serde_json::from_str(
            r#"{"kind":"pointer","phase":"move","x":0.25,"y":0.75,"edge":"bottom"}"#,
        )
        .unwrap();
        let DeviceInput::Pointer { phase, x, y } = pointer else {
            panic!("pointer input should be parsed");
        };
        assert!(matches!(phase, PointerPhase::Move));
        assert_eq!(normalized_touch_coordinate(x), 16_384);
        assert_eq!(normalized_touch_coordinate(y), 49_151);
        assert_eq!(touch_state(PointerPhase::Up), 0x02);

        let button: DeviceInput =
            serde_json::from_str(r#"{"kind":"button","button":"appSwitcher"}"#).unwrap();
        assert!(matches!(
            button,
            DeviceInput::Button {
                button: DeviceButton::AppSwitcher
            }
        ));

        let messages = [
            r#"{"kind":"multiPointer","phase":"down","first":{"x":0.2,"y":0.3},"second":{"x":0.8,"y":0.7}}"#,
            r#"{"kind":"scroll","deltaX":12,"deltaY":-30,"x":0.5,"y":0.5}"#,
            r#"{"kind":"rotate","direction":"right"}"#,
        ];
        assert!(
            messages
                .iter()
                .all(|message| serde_json::from_str::<DeviceInput>(message).is_ok())
        );
    }

    #[tokio::test]
    async fn first_frame_is_announced_after_ready() {
        let (output, mut input) = tokio::io::duplex(1024);
        let mut protocol = ProtocolWriter { output };
        protocol.announce_first_frame(&[1, 2, 3]).await.unwrap();
        drop(protocol);

        let mut bytes = Vec::new();
        input.read_to_end(&mut bytes).await.unwrap();
        let ready = br#"{"width":1,"height":1}"#;
        let mut expected = vec![1];
        expected.extend_from_slice(&(ready.len() as u32).to_be_bytes());
        expected.extend_from_slice(ready);
        expected.push(2);
        expected.extend_from_slice(&15_u32.to_be_bytes());
        expected.extend_from_slice(&3_u32.to_be_bytes());
        expected.extend_from_slice(&0_u32.to_be_bytes());
        expected.extend_from_slice(&1_u16.to_be_bytes());
        expected.extend_from_slice(&1_u16.to_be_bytes());
        expected.extend_from_slice(&[1, 2, 3]);
        assert_eq!(bytes, expected);
    }

    #[tokio::test]
    async fn oversized_control_message_is_rejected_before_allocating_its_payload() {
        let length = (CONTROL_MESSAGE_BYTES_MAXIMUM as u32 + 1).to_be_bytes();
        let mut bytes = vec![17];
        bytes.extend_from_slice(&length);
        let Err(error) = read_control_message(&mut bytes.as_slice()).await else {
            panic!("the oversized message should be rejected");
        };
        assert!(error.to_string().contains("control-message limit"));
    }
}
