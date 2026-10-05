//! Each refactor against code it applies to and code it must leave alone. A refactor that went
//! through is held to the same two promises: the result parses as before, and the inspections
//! find nothing in it that they did not find in the original.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use php_format::FormatOptions;
use php_syntax::{TextRange, parse};

use super::{Change, RefactorEnv, with_refactors};
use crate::inspections::tests::index_with;
use crate::inspections::{Externals, InspectionEnv, InspectionSettings, inspect};
use crate::references::Sources;

mod extract_method;
mod extract_variable;
mod inline_variable;

pub(super) const CURSOR: &str = "$0";
const START: char = '«';
const END: char = '»';

struct Files(HashMap<PathBuf, String>);

impl Sources for Files {
    fn candidates(&self, word: &str) -> Vec<PathBuf> {
        let mut found: Vec<PathBuf> = self
            .0
            .iter()
            .filter(|(_, text)| text.to_ascii_lowercase().contains(word))
            .map(|(path, _)| path.clone())
            .collect();
        found.sort();
        found
    }

    fn text(&self, path: &Path) -> Option<String> {
        self.0.get(path).cloned()
    }
}

/// What a refactor did, by file name relative to the project.
pub(super) struct Done {
    pub text: String,
    pub files: BTreeMap<String, String>,
    pub moves: Vec<(String, String)>,
    pub change: Change,
}

pub(super) struct Outcome {
    pub offered: Vec<String>,
    pub result: Option<Result<Done, String>>,
}

/// The source without its markers, and the range the markers (a cursor or a selection) stand for.
pub(super) fn split_range(source: &str) -> (String, TextRange) {
    if let (Some(start), Some(end)) = (source.find(START), source.find(END)) {
        let clean = source.replacen(START, "", 1).replacen(END, "", 1);
        let end = end - START.len_utf8();
        return (clean, TextRange::new((start as u32).into(), (end as u32).into()));
    }
    let offset = source.find(CURSOR).unwrap_or(0);
    (source.replacen(CURSOR, "", 1), TextRange::empty((offset as u32).into()))
}

fn name_of(path: &Path) -> String {
    path.strip_prefix("/project")
        .unwrap_or(path)
        .to_string_lossy()
        .trim_start_matches('/')
        .to_string()
}

fn findings_of(files: &[(String, String)], current: &str) -> Vec<(String, String)> {
    let refs: Vec<(&str, &str)> = files
        .iter()
        .map(|(path, text)| (path.as_str(), text.as_str()))
        .collect();
    let index = index_with(&refs, current);
    let settings = InspectionSettings::default();
    let externals = Externals::none();
    let mut out = Vec::new();
    let mut all: Vec<(String, &str)> = files.iter().map(|(path, text)| (path.clone(), text.as_str())).collect();
    all.push(("current.php".to_string(), current));
    for (path, text) in all {
        let tree = parse(text);
        let root = tree.syntax();
        let env = InspectionEnv {
            index: &index,
            text,
            root: &root,
            settings: &settings,
            ready: true,
            externals: &externals,
        };
        for finding in inspect(&env) {
            out.push((
                path.clone(),
                format!("{} {}", finding.diagnostic.code, finding.diagnostic.message),
            ));
        }
        for error in tree.errors() {
            out.push((path.clone(), format!("syntax {}", error.message)));
        }
    }
    out.sort();
    out
}

/// Runs the refactor with this title at the marker of `source`, or returns what was offered.
pub(super) fn run(files: &[(&str, &str)], source: &str, title: &str) -> Outcome {
    run_with(files, source, title, &FormatOptions::default())
}

pub(super) fn run_with(files: &[(&str, &str)], source: &str, title: &str, format: &FormatOptions) -> Outcome {
    let (clean, range) = split_range(source);
    let index = index_with(files, &clean);
    let tree = parse(&clean);
    let root = tree.syntax();
    let settings = InspectionSettings::default();
    let externals = Externals::none();
    let env = InspectionEnv {
        index: &index,
        text: &clean,
        root: &root,
        settings: &settings,
        ready: true,
        externals: &externals,
    };
    let mut texts: HashMap<PathBuf, String> = files
        .iter()
        .map(|(path, text)| (PathBuf::from(format!("/project/{path}")), (*text).to_string()))
        .collect();
    let current_path = PathBuf::from("/project/current.php");
    texts.insert(current_path.clone(), clean.clone());
    let sources = Files(texts.clone());
    let renv = RefactorEnv {
        env: &env,
        path: &current_path,
        sources: &sources,
        composer: None,
        format: format.clone(),
    };
    with_refactors(&renv, range, |refactors| {
        let offered: Vec<String> = refactors.iter().map(|refactor| refactor.title.clone()).collect();
        let Some(found) = refactors.iter().find(|refactor| refactor.title == title) else {
            return Outcome { offered, result: None };
        };
        let result = found.run().map(|change| {
            let mut files_after: BTreeMap<String, String> = BTreeMap::new();
            for file in &change.files {
                let before = texts.get(&file.path).cloned().unwrap_or_default();
                let edits: Vec<crate::completion::TextEdit> = file
                    .edits
                    .iter()
                    .map(|edit| crate::completion::TextEdit {
                        start: edit.start,
                        end: edit.end,
                        new_text: edit.text.clone(),
                    })
                    .collect();
                files_after.insert(name_of(&file.path), crate::actions::apply(&before, &edits));
            }
            let text = files_after.get("current.php").cloned().unwrap_or_else(|| clean.clone());
            let moves = change
                .moves
                .iter()
                .map(|moved| (name_of(&moved.from), name_of(&moved.to)))
                .collect();
            Done {
                text,
                files: files_after,
                moves,
                change,
            }
        });
        Outcome {
            offered,
            result: Some(result),
        }
    })
}

/// The current file after a refactor, which must parse and trouble the inspections no more than before.
pub(super) fn applied(files: &[(&str, &str)], source: &str, title: &str) -> String {
    let done = done(files, source, title);
    done.text
}

pub(super) fn done(files: &[(&str, &str)], source: &str, title: &str) -> Done {
    let outcome = run(files, source, title);
    let Some(result) = outcome.result else {
        panic!("no refactor '{title}' among {:?}", outcome.offered);
    };
    let done = match result {
        Ok(done) => done,
        Err(reason) => panic!("'{title}' was refused: {reason}"),
    };
    check_result(files, source, &done);
    done
}

/// The reason a refactor that is offered cannot be done.
pub(super) fn refused(files: &[(&str, &str)], source: &str, title: &str) -> String {
    let outcome = run(files, source, title);
    match outcome.result {
        Some(Err(reason)) => reason,
        Some(Ok(done)) => panic!("'{title}' was not refused, it gave {:?}", done.text),
        None => panic!("no refactor '{title}' among {:?}", outcome.offered),
    }
}

pub(super) fn offered(files: &[(&str, &str)], source: &str) -> Vec<String> {
    run(files, source, "\u{0}").offered
}

fn check_result(files: &[(&str, &str)], source: &str, done: &Done) {
    let (clean, _) = split_range(source);
    let before_files: Vec<(String, String)> = files
        .iter()
        .map(|(p, t)| ((*p).to_string(), (*t).to_string()))
        .collect();
    let before = findings_of(&before_files, &clean);
    let mut after_files: Vec<(String, String)> = Vec::new();
    for (path, text) in &before_files {
        let moved_to = done
            .moves
            .iter()
            .find(|(from, _)| from == path)
            .map(|(_, to)| to.clone());
        let text = done.files.get(path).cloned().unwrap_or_else(|| text.clone());
        after_files.push((moved_to.unwrap_or_else(|| path.clone()), text));
    }
    let after_current = done.text.clone();
    let after = findings_of(&after_files, &after_current);
    let mut remaining = before.clone();
    let mut new: Vec<&(String, String)> = Vec::new();
    for item in &after {
        match remaining.iter().position(|old| old == item) {
            Some(at) => {
                remaining.remove(at);
            }
            None => new.push(item),
        }
    }
    assert!(
        new.is_empty(),
        "the refactor brought in new findings: {new:?}\nafter:\n{after_current}"
    );
}
