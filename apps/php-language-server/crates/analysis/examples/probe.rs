//! Asks the analyses a question about a real project: `cargo run --release -p php-analysis --example
//! probe -- <project> <stubs> <file> <line> <column> [complete|hover|definition]`. Lines and columns
//! count from 1 and in bytes.

use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

use php_analysis::Analyzer;
use php_analysis::completion::{CompletionOptions, complete};
use php_index::indexer::{self, IndexEvent};
use php_index::{Project, StubFile};
use php_syntax::{PhpVersion, parse};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 5 {
        eprintln!("usage: probe <project> <stubs> <file> <line> <column> [complete|hover|definition]");
        std::process::exit(2);
    }
    let threads = std::thread::available_parallelism().map_or(4, usize::from);
    let stubs = Mutex::new(Vec::new());
    indexer::run(
        indexer::discover_stubs(Path::new(&args[1])),
        None,
        Some(Path::new(&args[1])),
        threads,
        &|event| {
            if let IndexEvent::Files(batch) = event {
                stubs
                    .lock()
                    .expect("lock")
                    .extend(batch.into_iter().map(|file| StubFile {
                        path: file.path,
                        extension: file.extension.unwrap_or_default(),
                        symbols: file.symbols,
                    }));
            }
        },
    );
    let stubs = stubs.into_inner().expect("lock");
    let mut project = Project::open(Path::new(&args[0]), PhpVersion::V8_4);
    let files = indexer::discover_project(&project.root, project.composer.as_ref());
    let collected = Mutex::new(Vec::new());
    indexer::run(files, None, None, threads, &|event| {
        if let IndexEvent::Files(batch) = event {
            collected.lock().expect("lock").extend(batch);
        }
    });
    let extensions = project.extensions();
    project.apply(collected.into_inner().expect("lock"));
    project.index.set_stubs(&stubs, &extensions);

    let text = std::fs::read_to_string(&args[2]).expect("the file reads");
    let line: usize = args[3].parse().expect("a line");
    let column: usize = args[4].parse().expect("a column");
    let offset: usize = text.split_inclusive('\n').take(line - 1).map(str::len).sum::<usize>() + column - 1;
    let mode = args.get(5).map_or("complete", String::as_str);
    let started = Instant::now();
    match mode {
        "hover" | "definition" => {
            let root = parse(&text).syntax();
            let analyzer = Analyzer::new(&project.index, &root, offset as u32);
            if mode == "hover" {
                match analyzer.hover(offset as u32, Some(&project.root)) {
                    Some(hover) => println!("{}", hover.markdown),
                    None => println!("nothing"),
                }
            } else {
                for place in analyzer.definitions(offset as u32) {
                    println!("{place:?}");
                }
            }
        }
        _ => {
            let list = complete(&project.index, &text, offset as u32, CompletionOptions::default());
            for item in list.items.iter().take(25) {
                println!(
                    "{:?} {} {} | {}{}",
                    item.kind,
                    item.label,
                    item.detail.as_deref().unwrap_or(""),
                    item.description.as_deref().unwrap_or(""),
                    if item.additional_edits.is_empty() {
                        ""
                    } else {
                        " (+import)"
                    }
                );
            }
            println!(
                "{} items{} in {:?}",
                list.items.len(),
                if list.incomplete { "+" } else { "" },
                started.elapsed()
            );
            return;
        }
    }
    println!("in {:?}", started.elapsed());
}
