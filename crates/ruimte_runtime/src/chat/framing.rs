use std::io;

use tokio::io::{AsyncBufRead, AsyncBufReadExt};

pub async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
    limit: usize,
) -> io::Result<usize> {
    line.clear();
    loop {
        let buffer = reader.fill_buf().await?;
        if buffer.is_empty() {
            return Ok(line.len());
        }
        let taken = buffer
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(buffer.len());
        if line.len().saturating_add(taken) > limit {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "line exceeds the configured limit",
            ));
        }
        line.extend_from_slice(&buffer[..taken]);
        reader.consume(taken);
        if line.last() == Some(&b'\n') {
            return Ok(line.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[tokio::test]
    async fn preserves_complete_and_unterminated_lines() {
        let mut reader = BufReader::with_capacity(2, &b"one\nlast"[..]);
        let mut line = Vec::new();
        assert_eq!(
            read_bounded_line(&mut reader, &mut line, 8).await.unwrap(),
            4
        );
        assert_eq!(line, b"one\n");
        assert_eq!(
            read_bounded_line(&mut reader, &mut line, 8).await.unwrap(),
            4
        );
        assert_eq!(line, b"last");
        assert_eq!(
            read_bounded_line(&mut reader, &mut line, 8).await.unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn fails_before_growing_past_the_limit() {
        let mut reader = BufReader::with_capacity(2, &b"toolong\n"[..]);
        let mut line = Vec::new();
        assert_eq!(
            read_bounded_line(&mut reader, &mut line, 4)
                .await
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
        assert!(line.len() <= 4);
    }
}
