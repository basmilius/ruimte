//! Pest: test files made of function calls, the case class their closures run in and datasets.

pub mod calls;
pub mod case;

#[cfg(test)]
mod tests;

use php_index::Index;
use php_syntax::SyntaxNode;

use crate::decl::Declaration;
use crate::infer::Analyzer;
use crate::phpunit::strings::TestString;

/// The strings of a Pest call that name a dataset.
pub fn call_strings(_analyzer: &Analyzer<'_>, _call: &SyntaxNode) -> Vec<TestString> {
    Vec::new()
}

/// What a string of a Pest file that names a dataset refers to.
pub fn string_target(_analyzer: &Analyzer<'_>, _string: &TestString) -> Option<crate::target::Found> {
    None
}

/// Where datasets of this name are declared in the project.
pub fn dataset_declarations(index: &Index, name: &str) -> Vec<Declaration> {
    index
        .test_files()
        .flat_map(|(file, facts)| {
            facts
                .datasets
                .iter()
                .filter(|dataset| dataset.name == name)
                .map(|dataset| Declaration {
                    path: file.path.clone(),
                    origin: file.origin,
                    name_span: dataset.span,
                    span: dataset.span,
                })
        })
        .collect()
}

/// The datasets a `->with('')` can name: the ones the project declares and the ones of the file.
pub fn dataset_candidates(_index: &Index, _root: &SyntaxNode) -> Vec<crate::phpunit::complete::Candidate> {
    Vec::new()
}
