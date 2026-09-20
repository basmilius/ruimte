use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use clap::{Parser, Subcommand};
use parakeet_rs::{ExecutionConfig, ExecutionProvider, Nemotron, NemotronHandle};
use serde::Deserialize;
use serde_json::json;

const SAMPLE_RATE: usize = 16_000;
const MAX_SAMPLES: usize = SAMPLE_RATE * 600;
const MAX_LINE: u64 = 128 * 1024;

#[derive(Parser)]
struct Arguments {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Serve {
        #[arg(long)]
        model: PathBuf,
        #[arg(long)]
        cache: Option<PathBuf>,
    },
    Probe {
        #[arg(long)]
        model: PathBuf,
        #[arg(long)]
        cache: Option<PathBuf>,
    },
    Transcribe {
        #[arg(long)]
        model: PathBuf,
        #[arg(long, default_value = "auto")]
        language: String,
        #[arg(long)]
        cache: Option<PathBuf>,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Request {
    Start {
        #[serde(rename = "sessionId")]
        session_id: String,
        language: String,
    },
    Samples {
        #[serde(rename = "sessionId")]
        session_id: String,
        audio: String,
    },
    Stop {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Cancel {
        #[serde(rename = "sessionId")]
        session_id: String,
    },
}

fn load(model: &Path, cache: Option<&Path>) -> Result<Nemotron> {
    let _ = cache;
    // CoreML's neural-network compiler can terminate the process while loading this model.
    // A Rust error fallback cannot recover from that native crash.
    let handle = NemotronHandle::from_pretrained(
        model,
        Some(ExecutionConfig::new().with_execution_provider(ExecutionProvider::Cpu)),
    )?;
    Ok(Nemotron::from_shared(&handle))
}

fn emit(value: serde_json::Value) -> Result<()> {
    let mut output = std::io::stdout().lock();
    serde_json::to_writer(&mut output, &value)?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}

fn samples_from(bytes: &[u8]) -> Result<Vec<f32>> {
    if !bytes.len().is_multiple_of(4) {
        bail!("Audio ends inside a sample");
    }
    let samples: Vec<_> = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect();
    if samples.iter().any(|sample| !sample.is_finite()) {
        bail!("Audio contains a non-finite sample");
    }
    Ok(samples)
}

struct Run {
    id: String,
    heard: usize,
    pending: Vec<f32>,
    last_text: String,
}

fn feed(model: &mut Nemotron, run: &mut Run, samples: &[f32]) -> Result<()> {
    run.heard += samples.len();
    if run.heard > MAX_SAMPLES {
        bail!("A dictation can last at most ten minutes");
    }
    run.pending.extend_from_slice(samples);
    let chunk_size = model.chunk_samples();
    while run.pending.len() >= chunk_size {
        let chunk: Vec<_> = run.pending.drain(..chunk_size).collect();
        model.transcribe_chunk(&chunk)?;
        let text = model.get_transcript();
        if text != run.last_text {
            emit(json!({"type":"transcript", "sessionId":run.id, "text":text, "final":false}))?;
            run.last_text = text;
        }
    }
    Ok(())
}

fn finish(model: &mut Nemotron, run: &mut Run) -> Result<()> {
    if run.heard > 0 {
        // The decoder needs a complete chunk and trailing silence to release the final words.
        run.pending.resize(model.chunk_samples(), 0.0);
        model.transcribe_chunk(&run.pending)?;
        model.transcribe_chunk(&vec![0.0; model.chunk_samples()])?;
    }
    emit(
        json!({"type":"transcript", "sessionId":run.id, "text":model.get_transcript(), "final":true}),
    )?;
    emit(json!({"type":"ended", "sessionId":run.id}))
}

fn serve(model_path: &Path, cache: Option<&Path>) -> Result<()> {
    let mut model = load(model_path, cache)?;
    let mut run: Option<Run> = None;
    let mut input = std::io::stdin().lock();
    loop {
        let mut line = String::new();
        let read = input.by_ref().take(MAX_LINE + 1).read_line(&mut line)?;
        if read == 0 {
            break;
        }
        if read as u64 > MAX_LINE {
            bail!("Speech message too large");
        }
        let request: Request = serde_json::from_str(&line)?;
        match request {
            Request::Start {
                session_id,
                language,
            } => {
                if run.is_some() {
                    bail!("A dictation is already running");
                }
                // Reset the utterance and explicitly replace the previous language prompt.
                model.reset();
                if let Err(error) = model.set_target_lang(&language) {
                    emit(
                        json!({"type":"failed", "sessionId":session_id, "message":error.to_string()}),
                    )?;
                    continue;
                }
                run = Some(Run {
                    id: session_id.clone(),
                    heard: 0,
                    pending: Vec::new(),
                    last_text: String::new(),
                });
                emit(json!({"type":"ready", "sessionId":session_id}))?;
            }
            Request::Samples { session_id, audio } => {
                if let Some(active) = run.as_mut().filter(|active| active.id == session_id) {
                    let result = STANDARD
                        .decode(audio)
                        .map_err(anyhow::Error::from)
                        .and_then(|bytes| samples_from(&bytes))
                        .and_then(|samples| feed(&mut model, active, &samples));
                    if let Err(error) = result {
                        emit(
                            json!({"type":"failed", "sessionId":session_id, "message":error.to_string()}),
                        )?;
                        run = None;
                        model.reset();
                    }
                }
            }
            Request::Stop { session_id } => {
                if run.as_ref().is_some_and(|active| active.id == session_id) {
                    let mut active = run.take().unwrap();
                    if let Err(error) = finish(&mut model, &mut active) {
                        emit(
                            json!({"type":"failed", "sessionId":session_id, "message":error.to_string()}),
                        )?;
                    }
                    model.reset();
                }
            }
            Request::Cancel { session_id } => {
                if run.as_ref().is_some_and(|active| active.id == session_id) {
                    run = None;
                    model.reset();
                    emit(json!({"type":"ended", "sessionId":session_id}))?;
                }
            }
        }
    }
    Ok(())
}

fn main() -> Result<()> {
    match Arguments::parse().command {
        Command::Serve { model, cache } => serve(&model, cache.as_deref()),
        Command::Probe { model, cache } => {
            let model = load(&model, cache.as_deref())?;
            emit(json!({"present":true, "chunk_samples":model.chunk_samples()}))
        }
        Command::Transcribe {
            model,
            language,
            cache,
        } => {
            let mut model = load(&model, cache.as_deref())?;
            model.set_target_lang(&language)?;
            let mut run = Run {
                id: "cli".into(),
                heard: 0,
                pending: Vec::new(),
                last_text: String::new(),
            };
            let mut input = std::io::stdin().lock();
            let mut bytes = Vec::new();
            input
                .by_ref()
                .take((MAX_SAMPLES * 4 + 1) as u64)
                .read_to_end(&mut bytes)?;
            feed(&mut model, &mut run, &samples_from(&bytes)?)?;
            finish(&mut model, &mut run)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_audio_frames() {
        assert_eq!(samples_from(&0.5f32.to_le_bytes()).unwrap(), vec![0.5]);
        assert!(samples_from(&[0, 1, 2]).is_err());
        assert!(samples_from(&f32::NAN.to_le_bytes()).is_err());
    }
    #[test]
    fn session_identity_is_required() {
        assert!(serde_json::from_str::<Request>(r#"{"type":"stop"}"#).is_err());
        assert!(serde_json::from_str::<Request>(r#"{"type":"stop","sessionId":"a"}"#).is_ok());
    }
}
