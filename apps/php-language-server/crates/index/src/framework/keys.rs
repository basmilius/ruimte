//! The strings that name something a project declares, asked the same way whatever the framework:
//! what can be written there, where a name is declared, whether a name is certainly wrong.

use std::path::PathBuf;

use super::abilities::Abilities;
use super::config::ConfigKeys;
use super::env::EnvNames;
use super::routes::Routes;
use super::translations::Translations;
use super::views::Views;
use crate::index::Index;
use crate::model::Span;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum KeyKind {
    Config,
    Route,
    View,
    Translation,
    Env,
    Ability,
    /// A field of the form request the call is made on.
    Field,
    /// The name of a Blade component, after `<x-`.
    Component,
}

impl KeyKind {
    /// The kind an overlay marker names.
    pub fn parse(word: &str) -> Option<KeyKind> {
        Some(match word {
            "config" => KeyKind::Config,
            "route" => KeyKind::Route,
            "view" => KeyKind::View,
            "translation" => KeyKind::Translation,
            "env" => KeyKind::Env,
            "ability" => KeyKind::Ability,
            "field" => KeyKind::Field,
            _ => return None,
        })
    }

    pub fn label(self) -> &'static str {
        match self {
            KeyKind::Config => "config key",
            KeyKind::Route => "route",
            KeyKind::View => "view",
            KeyKind::Translation => "translation",
            KeyKind::Env => "environment variable",
            KeyKind::Ability => "ability",
            KeyKind::Field => "validated field",
            KeyKind::Component => "component",
        }
    }

    /// The inspection that reports a name of this kind that does not exist.
    pub fn inspection(self) -> Option<&'static str> {
        match self {
            KeyKind::Config => Some("unknown-config-key"),
            KeyKind::Route => Some("unknown-route"),
            KeyKind::View => Some("unknown-view"),
            KeyKind::Translation => Some("unknown-translation"),
            KeyKind::Env | KeyKind::Ability | KeyKind::Field | KeyKind::Component => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub key: String,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Definition {
    pub path: PathBuf,
    pub span: Span,
    pub detail: String,
}

fn candidate(key: &str, detail: impl Into<Option<String>>) -> Candidate {
    Candidate {
        key: key.to_string(),
        detail: detail.into(),
    }
}

/// Every name that can be written, to complete from.
pub fn candidates(index: &Index, kind: KeyKind, scope: Option<&str>) -> Vec<Candidate> {
    match kind {
        KeyKind::Field => scope
            .map(|class| {
                super::validation::fields_of(index, class)
                    .iter()
                    .map(|field| candidate(&field.name, None))
                    .collect()
            })
            .unwrap_or_default(),
        KeyKind::Config => index
            .section::<ConfigKeys>()
            .keys()
            .map(|entry| candidate(&entry.key, entry.value.clone()))
            .collect(),
        KeyKind::Component => index
            .section::<Views>()
            .components
            .iter()
            .map(|component| candidate(&component.tag, component.class.clone()))
            .collect(),
        KeyKind::Route => index
            .section::<Routes>()
            .names
            .iter()
            .map(|route| candidate(&route.name, None))
            .collect(),
        KeyKind::View => index
            .section::<Views>()
            .views
            .iter()
            .map(|view| candidate(&view.name, None))
            .collect(),
        KeyKind::Translation => {
            let translations = index.section::<Translations>();
            let mut seen = std::collections::HashSet::new();
            translations
                .keys()
                .filter(|entry| !entry.group || entry.value.is_some())
                .filter(|entry| seen.insert(entry.key.clone()))
                .map(|entry| candidate(&entry.key, entry.value.clone()))
                .collect()
        }
        KeyKind::Env => {
            let env = index.section::<EnvNames>();
            let mut seen = std::collections::HashSet::new();
            env.names
                .iter()
                .filter(|entry| seen.insert(entry.name.clone()))
                .map(|entry| candidate(&entry.name, None))
                .collect()
        }
        KeyKind::Ability => {
            let abilities = index.section::<Abilities>();
            let mut seen = std::collections::HashSet::new();
            abilities
                .abilities
                .iter()
                .filter(|ability| seen.insert(ability.name.clone()))
                .map(|ability| candidate(&ability.name, ability.policy.clone()))
                .collect()
        }
    }
}

/// Where a name is declared.
pub fn definitions(index: &Index, kind: KeyKind, key: &str, scope: Option<&str>) -> Vec<Definition> {
    match kind {
        KeyKind::Field => scope
            .map(|class| {
                super::validation::fields_of(index, class)
                    .into_iter()
                    .filter(|field| field.name == key)
                    .map(|field| Definition {
                        path: field.path,
                        span: field.span,
                        detail: String::new(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        KeyKind::Config => index
            .section::<ConfigKeys>()
            .find(key)
            .map(|entry| Definition {
                path: entry.path.clone(),
                span: entry.span,
                detail: entry.value.clone().unwrap_or_default(),
            })
            .into_iter()
            .collect(),
        KeyKind::Component => index
            .section::<Views>()
            .component(key)
            .map(|component| Definition {
                path: component.path.clone(),
                span: Span::default(),
                detail: component.class.clone().unwrap_or_default(),
            })
            .into_iter()
            .collect(),
        KeyKind::Route => index
            .section::<Routes>()
            .find(key)
            .map(|route| Definition {
                path: route.path.clone(),
                span: route.span,
                detail: String::new(),
            })
            .into_iter()
            .collect(),
        KeyKind::View => index
            .section::<Views>()
            .find(key)
            .map(|view| Definition {
                path: view.path.clone(),
                span: Span::default(),
                detail: String::new(),
            })
            .into_iter()
            .collect(),
        KeyKind::Translation => index
            .section::<Translations>()
            .find(key)
            .into_iter()
            .map(|entry| Definition {
                path: entry.path.clone(),
                span: entry.span,
                detail: match (&entry.locale, &entry.value) {
                    (Some(locale), Some(value)) => format!("{locale}: {value}"),
                    (Some(locale), None) => locale.clone(),
                    _ => String::new(),
                },
            })
            .collect(),
        KeyKind::Env => index
            .section::<EnvNames>()
            .find_all(key)
            .into_iter()
            .map(|entry| Definition {
                path: entry.path.clone(),
                span: entry.span,
                detail: String::new(),
            })
            .collect(),
        KeyKind::Ability => index
            .section::<Abilities>()
            .find_all(key)
            .into_iter()
            .map(|ability| Definition {
                path: ability.path.clone(),
                span: ability.span,
                detail: ability.policy.clone().unwrap_or_default(),
            })
            .collect(),
    }
}

/// Whether a name is certainly wrong: the project declares everything of its kind that it can,
/// and the name is not among it.
pub fn is_missing(index: &Index, kind: KeyKind, key: &str) -> bool {
    match kind {
        KeyKind::Config => index.section::<ConfigKeys>().is_missing(index, key),
        KeyKind::Route => index.section::<Routes>().is_missing(index, key),
        KeyKind::View => index.section::<Views>().is_missing(key),
        KeyKind::Translation => index.section::<Translations>().is_missing(key),
        KeyKind::Env | KeyKind::Ability | KeyKind::Field | KeyKind::Component => false,
    }
}
