use std::{fs::File, os::fd::FromRawFd, time::Duration};

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand, ValueEnum};
use idevice::{
    IdeviceService, ReadWrite, RsdService,
    core_device::{
        CallInfoBlob, DisplayServiceClient, HevcDepacketizer, RtpPacket, build_screen_audio_offer,
        build_screen_video_offer, build_start_audio_parameters, build_start_video_parameters,
    },
    core_device_proxy::CoreDeviceProxy,
    rsd::RsdHandshake,
    tcp::handle::UdpSocketHandle,
    usbmuxd::{UsbmuxdAddr, UsbmuxdConnection},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UdpSocket;

mod native_remoted;

use native_remoted::{NativeRemotedTunnel, connect_rsd};

const MAGIC: [u8; 8] = [0x52, 0x44, 0x45, 0x56, 0x01, 0x00, 0x00, 0x00];
const CLIENT_SUPPORTED_FEATURES: u64 = 140;
const MAX_FRAME_BYTES: usize = 8 * 1024 * 1024;

#[derive(Parser)]
struct Arguments {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    PhysicalIos {
        #[arg(long)]
        udid: Option<String>,
        device_id: String,
    },
    Probe {
        #[arg(long)]
        udid: Option<String>,
        #[arg(long, default_value_t = 8)]
        timeout: u64,
        #[arg(long, value_enum, default_value_t = ProbeTransport::Wireless)]
        transport: ProbeTransport,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum ProbeTransport {
    Wireless,
    Usb,
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
    _audio_udp: MediaUdp,
    video_udp: MediaUdp,
    _native_tunnel: Option<NativeRemotedTunnel>,
    transport: &'static str,
}

struct ProtocolWriter {
    output: tokio::fs::File,
}

impl ProtocolWriter {
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

#[tokio::main]
async fn main() {
    match Arguments::parse().command {
        Command::PhysicalIos { udid, device_id: _ } => run_physical_helper(udid).await,
        Command::Probe {
            udid,
            timeout,
            transport,
        } => {
            if let Err(error) =
                probe_stream(udid.as_deref(), Duration::from_secs(timeout), transport).await
            {
                eprintln!("Rust iOS stream probe failed: {error:#}");
                std::process::exit(1);
            }
        }
    }
}

async fn run_physical_helper(udid: Option<String>) {
    let mut input = tokio::io::stdin();
    let mut magic = [0_u8; MAGIC.len()];
    if input.read_exact(&mut magic).await.is_err() || magic != MAGIC {
        std::process::exit(2);
    }
    let mut protocol = match ProtocolWriter::open().await {
        Ok(protocol) => protocol,
        Err(_) => std::process::exit(2),
    };
    let result = stream_physical_ios(udid.as_deref(), input, &mut protocol).await;
    if let Err(error) = result {
        let _ = protocol
            .error(&format!("The physical iOS stream stopped: {error:#}"))
            .await;
        std::process::exit(1);
    }
}

async fn probe_stream(
    udid: Option<&str>,
    timeout: Duration,
    transport: ProbeTransport,
) -> Result<()> {
    let mut session = match transport {
        ProbeTransport::Wireless => open_wireless_stream(udid).await?,
        ProbeTransport::Usb => open_direct_stream(udid).await?,
    };
    let mut depacketizer = HevcDepacketizer::new();
    let mut access_unit = Vec::new();
    let mut packets = 0_u64;
    let frame = tokio::time::timeout(timeout, async {
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
    println!(
        "{}",
        serde_json::json!({
            "ok": true,
            "transport": session.transport,
            "codec": "hevc",
            "packets": packets,
            "frameBytes": frame.len()
        })
    );
    Ok(())
}

async fn stream_physical_ios(
    udid: Option<&str>,
    input: tokio::io::Stdin,
    protocol: &mut ProtocolWriter,
) -> Result<()> {
    let session = match open_wireless_stream(udid).await {
        Ok(session) => session,
        Err(wireless_error) => match open_direct_stream(udid).await {
            Ok(session) => session,
            Err(direct_error) => {
                bail!(
                    "wireless transport failed ({wireless_error:#}); direct CoreDevice transport failed ({direct_error:#})"
                );
            }
        },
    };
    protocol.ready().await?;

    let mut client = session.client;
    let mut udp = session.video_udp;
    let mut stop = Box::pin(wait_for_stop(input));
    let mut depacketizer = HevcDepacketizer::new();
    let mut access_unit = Vec::new();
    let mut sequence = 0_u32;

    loop {
        tokio::select! {
            _ = &mut stop => break,
            datagram = tokio::time::timeout(Duration::from_secs(5), udp.recv()) => {
                let datagram = match datagram {
                    Ok(result) => result.context("the display stream closed")?,
                    Err(_) => continue,
                };
                publish_rtp(datagram.as_ref(), &mut depacketizer, &mut access_unit, &mut sequence, protocol).await?;
            }
        }
    }
    client
        .stop_media_stream()
        .await
        .context("could not stop the display stream")?;
    Ok(())
}

async fn open_direct_stream(udid: Option<&str>) -> Result<ScreenMediaStream> {
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
    negotiate_screen_media(
        client,
        audio_udp,
        video_udp,
        adapter.host_ip().to_string(),
        adapter.peer_ip().to_string(),
        None,
        "usbmuxd-coredevice-proxy",
    )
    .await
}

async fn open_wireless_stream(udid: Option<&str>) -> Result<ScreenMediaStream> {
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
    negotiate_screen_media(
        client,
        audio_udp,
        video_udp,
        session.host_ip.to_string(),
        session.device_ip.to_string(),
        Some(session.tunnel),
        "remotepairingd",
    )
    .await
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

async fn wait_for_stop(mut input: tokio::io::Stdin) {
    loop {
        let mut header = [0_u8; 5];
        if input.read_exact(&mut header).await.is_err() {
            return;
        }
        let length = u32::from_be_bytes(header[1..5].try_into().unwrap()) as usize;
        let mut payload = vec![0_u8; length];
        if input.read_exact(&mut payload).await.is_err() || header[0] == 18 {
            return;
        }
    }
}

async fn negotiate_screen_media(
    mut client: DisplayServiceClient<Box<dyn ReadWrite>>,
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
    client
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
    client
        .start_media_stream(video_parameters)
        .await
        .context("the device refused the video stream")?;
    Ok(ScreenMediaStream {
        client,
        _audio_udp: audio_udp,
        video_udp,
        _native_tunnel: native_tunnel,
        transport,
    })
}

#[cfg(test)]
mod tests {
    use super::{Arguments, Command};
    use clap::Parser;

    #[test]
    fn physical_ios_accepts_the_daemon_device_id_after_the_hardware_udid() {
        let arguments = Arguments::try_parse_from([
            "ios-device-bridge",
            "physical-ios",
            "--udid",
            "hardware-udid",
            "daemon-device-id",
        ])
        .expect("the daemon launch command should be accepted");

        let Command::PhysicalIos { udid, device_id } = arguments.command else {
            panic!("the physical iOS command should be parsed");
        };
        assert_eq!(udid.as_deref(), Some("hardware-udid"));
        assert_eq!(device_id, "daemon-device-id");
    }
}
