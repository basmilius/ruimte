use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use tokio::sync::{Semaphore, mpsc, watch};
use tokio_util::sync::CancellationToken;

pub const LIVE_STREAM_MAGIC: &[u8; 8] = b"RSTM\x01\0\0\0";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LiveFormat {
    Jpeg,
    Hevc,
}

impl LiveFormat {
    pub const fn content_type(self) -> &'static str {
        match self {
            Self::Jpeg => "application/x-ruimte-jpeg-stream; version=1",
            Self::Hevc => "application/x-ruimte-hevc-stream; version=1",
        }
    }
}

#[derive(Clone, Debug)]
pub struct LiveFrame {
    pub sequence: u32,
    pub width: u16,
    pub height: u16,
    pub data: Arc<Vec<u8>>,
    pub format: LiveFormat,
}

pub struct LiveSubscription {
    receiver: LiveReceiver,
    format: LiveFormat,
    release: Option<Box<dyn FnOnce() + Send + 'static>>,
}

enum LiveReceiver {
    Latest(watch::Receiver<Option<LiveFrame>>),
    Ordered {
        receiver: mpsc::Receiver<OrderedFrame>,
        overflow: CancellationToken,
    },
}

struct OrderedFrame {
    frame: LiveFrame,
    _bytes: tokio::sync::OwnedSemaphorePermit,
}

#[derive(Clone)]
pub struct OrderedLiveSender {
    sender: mpsc::Sender<OrderedFrame>,
    bytes: Arc<Semaphore>,
    overflow: CancellationToken,
    awaiting_key_frame: Arc<AtomicBool>,
}

impl OrderedLiveSender {
    pub fn try_send(&self, frame: LiveFrame) -> bool {
        if frame.format == LiveFormat::Hevc && self.awaiting_key_frame.load(Ordering::Acquire) {
            if !hevc_key_frame(&frame.data) {
                return true;
            }
            self.awaiting_key_frame.store(false, Ordering::Release);
        }
        let byte_count = u32::try_from(frame.data.len().max(1));
        let permit = byte_count
            .ok()
            .and_then(|byte_count| self.bytes.clone().try_acquire_many_owned(byte_count).ok());
        let Some(permit) = permit else {
            self.overflow.cancel();
            return false;
        };
        if self
            .sender
            .try_send(OrderedFrame {
                frame,
                _bytes: permit,
            })
            .is_err()
        {
            self.overflow.cancel();
            return false;
        }
        true
    }
}

impl LiveSubscription {
    pub fn new(
        receiver: watch::Receiver<Option<LiveFrame>>,
        release: impl FnOnce() + Send + 'static,
    ) -> Self {
        Self {
            receiver: LiveReceiver::Latest(receiver),
            format: LiveFormat::Jpeg,
            release: Some(Box::new(release)),
        }
    }

    pub fn with_format(
        receiver: watch::Receiver<Option<LiveFrame>>,
        format: LiveFormat,
        release: impl FnOnce() + Send + 'static,
    ) -> Self {
        Self {
            receiver: LiveReceiver::Latest(receiver),
            format,
            release: Some(Box::new(release)),
        }
    }

    pub fn ordered(
        format: LiveFormat,
        frame_capacity: usize,
        byte_capacity: usize,
        release: impl FnOnce() + Send + 'static,
    ) -> (OrderedLiveSender, Self) {
        let (sender, receiver) = mpsc::channel(frame_capacity);
        let overflow = CancellationToken::new();
        (
            OrderedLiveSender {
                sender,
                bytes: Arc::new(Semaphore::new(byte_capacity)),
                overflow: overflow.clone(),
                awaiting_key_frame: Arc::new(AtomicBool::new(format == LiveFormat::Hevc)),
            },
            Self {
                receiver: LiveReceiver::Ordered { receiver, overflow },
                format,
                release: Some(Box::new(release)),
            },
        )
    }

    pub const fn format(&self) -> LiveFormat {
        self.format
    }

    pub async fn recv(&mut self) -> Option<LiveFrame> {
        match &mut self.receiver {
            LiveReceiver::Latest(receiver) => loop {
                if receiver.changed().await.is_err() {
                    return None;
                }
                if let Some(frame) = receiver.borrow_and_update().clone() {
                    return Some(frame);
                }
            },
            LiveReceiver::Ordered { receiver, overflow } => {
                if overflow.is_cancelled() {
                    return None;
                }
                tokio::select! {
                    biased;
                    _ = overflow.cancelled() => None,
                    frame = receiver.recv() => frame.map(|queued| queued.frame),
                }
            }
        }
    }
}

pub fn hevc_key_frame(data: &[u8]) -> bool {
    for index in 0..data.len() {
        let header = if data.get(index..index + 4) == Some(&[0, 0, 0, 1]) {
            index + 4
        } else if data.get(index..index + 3) == Some(&[0, 0, 1]) {
            index + 3
        } else {
            continue;
        };
        if let Some(first_header_byte) = data.get(header)
            && (16..=23).contains(&((first_header_byte >> 1) & 0x3f))
        {
            return true;
        }
    }
    false
}

impl Drop for LiveSubscription {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            release();
        }
    }
}

pub fn encode_live_frame(frame: &LiveFrame) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(12 + frame.data.len());
    encoded.extend_from_slice(&(frame.data.len() as u32).to_be_bytes());
    encoded.extend_from_slice(&frame.sequence.to_be_bytes());
    encoded.extend_from_slice(&frame.width.to_be_bytes());
    encoded.extend_from_slice(&frame.height.to_be_bytes());
    encoded.extend_from_slice(&frame.data);
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_envelope_matches_the_rstm_wire_format() {
        let frame = LiveFrame {
            sequence: 0x0102_0304,
            width: 640,
            height: 480,
            data: Arc::new(vec![0xaa, 0xbb]),
            format: LiveFormat::Hevc,
        };
        assert_eq!(
            encode_live_frame(&frame),
            [0, 0, 0, 2, 1, 2, 3, 4, 2, 128, 1, 224, 0xaa, 0xbb,]
        );
        assert_eq!(
            frame.format.content_type(),
            "application/x-ruimte-hevc-stream; version=1"
        );
    }

    #[test]
    fn hevc_key_frame_recognizes_irap_nal_units() {
        assert!(hevc_key_frame(&[0, 0, 0, 1, 19 << 1, 1]));
        assert!(hevc_key_frame(&[0, 0, 1, 21 << 1, 1]));
        assert!(!hevc_key_frame(&[0, 0, 0, 1, 1 << 1, 1]));
        assert!(!hevc_key_frame(&[0, 0, 1]));
    }

    #[tokio::test]
    async fn ordered_hevc_subscription_starts_at_a_key_frame() {
        let (sender, mut subscription) =
            LiveSubscription::ordered(LiveFormat::Hevc, 32, 1024, || {});
        assert!(sender.try_send(LiveFrame {
            sequence: 0,
            width: 1,
            height: 1,
            data: Arc::new(vec![0, 0, 0, 1, 1 << 1, 1]),
            format: LiveFormat::Hevc,
        }));
        assert!(sender.try_send(LiveFrame {
            sequence: 1,
            width: 1,
            height: 1,
            data: Arc::new(vec![0, 0, 0, 1, 19 << 1, 1]),
            format: LiveFormat::Hevc,
        }));
        assert!(sender.try_send(LiveFrame {
            sequence: 2,
            width: 1,
            height: 1,
            data: Arc::new(vec![0, 0, 0, 1, 1 << 1, 1]),
            format: LiveFormat::Hevc,
        }));

        assert_eq!(subscription.recv().await.unwrap().sequence, 1);
        assert_eq!(subscription.recv().await.unwrap().sequence, 2);
    }

    #[tokio::test]
    async fn ordered_hevc_subscription_keeps_bursts_and_closes_on_byte_overflow() {
        let (sender, mut subscription) = LiveSubscription::ordered(LiveFormat::Hevc, 32, 16, || {});
        for sequence in 0..3 {
            assert!(sender.try_send(LiveFrame {
                sequence,
                width: 1,
                height: 1,
                data: Arc::new(if sequence == 0 {
                    vec![0, 0, 0, 1, 19 << 1, 1]
                } else {
                    vec![sequence as u8; 4]
                }),
                format: LiveFormat::Hevc,
            }));
        }
        for sequence in 0..3 {
            assert_eq!(subscription.recv().await.unwrap().sequence, sequence);
        }

        assert!(sender.try_send(LiveFrame {
            sequence: 3,
            width: 1,
            height: 1,
            data: Arc::new(vec![3; 12]),
            format: LiveFormat::Hevc,
        }));
        assert!(!sender.try_send(LiveFrame {
            sequence: 4,
            width: 1,
            height: 1,
            data: Arc::new(vec![4; 8]),
            format: LiveFormat::Hevc,
        }));
        assert!(subscription.recv().await.is_none());
    }
}
