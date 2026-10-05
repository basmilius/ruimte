use std::collections::HashMap;
use std::error::Error;

use crossbeam_channel::Receiver;
use lsp_server::{Connection, ErrorCode, Message, Notification, Request, RequestId, Response};
use lsp_types::notification::{
    DidChangeConfiguration, DidChangeTextDocument, DidCloseTextDocument, DidOpenTextDocument, Notification as _,
    PublishDiagnostics,
};
use lsp_types::request::{
    DocumentDiagnosticRequest, DocumentSymbolRequest, FoldingRangeRequest, Request as _, SelectionRangeRequest,
    WorkspaceConfiguration, WorkspaceDiagnosticRefresh,
};
use lsp_types::{
    ConfigurationItem, ConfigurationParams, DiagnosticOptions, DiagnosticServerCapabilities,
    DidChangeConfigurationParams, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams,
    DocumentDiagnosticParams, DocumentDiagnosticReport, DocumentDiagnosticReportResult, DocumentSymbolParams,
    DocumentSymbolResponse, FoldingRangeParams, FoldingRangeProviderCapability, FullDocumentDiagnosticReport,
    InitializeParams, InitializeResult, OneOf, PublishDiagnosticsParams, RelatedFullDocumentDiagnosticReport,
    SelectionRangeParams, SelectionRangeProviderCapability, ServerCapabilities, ServerInfo, TextDocumentSyncCapability,
    TextDocumentSyncKind, TextDocumentSyncOptions, Uri,
};
use php_analysis::{PositionEncoding, diagnostics, document_symbols, folding_ranges, selection_ranges};
use php_syntax::PhpVersion;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::config::{SECTION, Settings};
use crate::convert::{self, Mapper};
use crate::documents::Documents;

type BoxError = Box<dyn Error + Send + Sync>;

/// Runs the server on a connection until the client shuts it down.
pub fn run(connection: Connection) -> Result<(), BoxError> {
    let (id, params) = connection.initialize_start()?;
    let params: InitializeParams = serde_json::from_value(params)?;
    let mut server = Server::new(&connection, &params);
    let result = InitializeResult {
        capabilities: server.capabilities(),
        server_info: Some(ServerInfo {
            name: "php-language-server".to_string(),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        }),
    };
    connection.initialize_finish(id, serde_json::to_value(result)?)?;
    server.main_loop(&connection.receiver)
}

struct Server<'a> {
    connection: &'a Connection,
    documents: Documents,
    encoding: PositionEncoding,
    settings: Settings,
    /// The client pulls diagnostics, so the server does not push them.
    pull_diagnostics: bool,
    hierarchical_symbols: bool,
    configuration_support: bool,
    diagnostic_refresh_support: bool,
    /// Documents whose diagnostics are out of date, published once the queue of messages is empty.
    dirty: Vec<Uri>,
    /// Questions asked of the client: which document each `workspace/configuration` answer is for.
    pending_configuration: HashMap<RequestId, Uri>,
    next_request_id: i32,
}

impl<'a> Server<'a> {
    fn new(connection: &'a Connection, params: &InitializeParams) -> Server<'a> {
        let capabilities = &params.capabilities;
        let settings = params
            .initialization_options
            .as_ref()
            .map(Settings::from_value)
            .unwrap_or_default();
        let text_document = capabilities.text_document.as_ref();
        Server {
            connection,
            documents: Documents::default(),
            encoding: convert::choose_encoding(
                capabilities
                    .general
                    .as_ref()
                    .and_then(|general| general.position_encodings.as_deref()),
            ),
            settings,
            pull_diagnostics: text_document.is_some_and(|text_document| text_document.diagnostic.is_some()),
            hierarchical_symbols: text_document
                .and_then(|text_document| text_document.document_symbol.as_ref())
                .and_then(|symbol| symbol.hierarchical_document_symbol_support)
                .unwrap_or(false),
            configuration_support: capabilities
                .workspace
                .as_ref()
                .and_then(|workspace| workspace.configuration)
                .unwrap_or(false),
            diagnostic_refresh_support: capabilities
                .workspace
                .as_ref()
                .and_then(|workspace| workspace.diagnostic.as_ref())
                .and_then(|diagnostic| diagnostic.refresh_support)
                .unwrap_or(false),
            dirty: Vec::new(),
            pending_configuration: HashMap::new(),
            next_request_id: 0,
        }
    }

    fn capabilities(&self) -> ServerCapabilities {
        ServerCapabilities {
            position_encoding: Some(convert::encoding_kind(self.encoding)),
            text_document_sync: Some(TextDocumentSyncCapability::Options(TextDocumentSyncOptions {
                open_close: Some(true),
                change: Some(TextDocumentSyncKind::INCREMENTAL),
                ..TextDocumentSyncOptions::default()
            })),
            document_symbol_provider: Some(OneOf::Left(true)),
            folding_range_provider: Some(FoldingRangeProviderCapability::Simple(true)),
            selection_range_provider: Some(SelectionRangeProviderCapability::Simple(true)),
            diagnostic_provider: self.pull_diagnostics.then(|| {
                DiagnosticServerCapabilities::Options(DiagnosticOptions {
                    identifier: Some("php".to_string()),
                    inter_file_dependencies: false,
                    workspace_diagnostics: false,
                    work_done_progress_options: Default::default(),
                })
            }),
            ..ServerCapabilities::default()
        }
    }

    fn main_loop(&mut self, receiver: &Receiver<Message>) -> Result<(), BoxError> {
        while let Ok(message) = receiver.recv() {
            if self.handle(message)? {
                return Ok(());
            }
            // Typing sends a change per keystroke: answer them all before spending time on diagnostics.
            while let Ok(message) = receiver.try_recv() {
                if self.handle(message)? {
                    return Ok(());
                }
            }
            self.publish_dirty()?;
        }
        Ok(())
    }

    /// Handles one message and says whether the server is done.
    fn handle(&mut self, message: Message) -> Result<bool, BoxError> {
        match message {
            Message::Request(request) => {
                if self.connection.handle_shutdown(&request)? {
                    return Ok(true);
                }
                self.request(request)?;
            }
            Message::Notification(notification) => self.notification(notification)?,
            Message::Response(response) => self.response(response)?,
        }
        Ok(false)
    }

    fn send(&self, message: impl Into<Message>) -> Result<(), BoxError> {
        self.connection.sender.send(message.into())?;
        Ok(())
    }

    fn request(&mut self, request: Request) -> Result<(), BoxError> {
        let id = request.id.clone();
        let response = match request.method.as_str() {
            DocumentSymbolRequest::METHOD => self.answer(id, request.params, Self::document_symbols),
            FoldingRangeRequest::METHOD => self.answer(id, request.params, Self::folding_ranges),
            SelectionRangeRequest::METHOD => self.answer(id, request.params, Self::selection_ranges),
            DocumentDiagnosticRequest::METHOD => self.answer(id, request.params, Self::pull_diagnostics_for),
            method => Response::new_err(
                id,
                ErrorCode::MethodNotFound as i32,
                format!("unsupported request {method}"),
            ),
        };
        self.send(response)
    }

    /// Decodes the parameters, runs a handler and wraps what it returns in a response.
    fn answer<P, R>(&mut self, id: RequestId, params: Value, handler: fn(&mut Self, P) -> Option<R>) -> Response
    where
        P: DeserializeOwned,
        R: serde::Serialize,
    {
        match serde_json::from_value::<P>(params) {
            Ok(params) => {
                let result = handler(self, params);
                Response::new_ok(id, result)
            }
            Err(error) => Response::new_err(id, ErrorCode::InvalidParams as i32, error.to_string()),
        }
    }

    fn document_symbols(&mut self, params: DocumentSymbolParams) -> Option<DocumentSymbolResponse> {
        let uri = params.text_document.uri;
        let hierarchical = self.hierarchical_symbols;
        let encoding = self.encoding;
        let document = self.documents.get_mut(&uri)?;
        let symbols = document_symbols(&document.parse().syntax());
        let mapper = Mapper {
            text: &document.text,
            index: &document.index,
            encoding,
        };
        if hierarchical {
            return Some(DocumentSymbolResponse::Nested(convert::hierarchical_symbols(
                &mapper, &symbols,
            )));
        }
        let mut flat = Vec::new();
        convert::flat_symbols(&mapper, &uri, &symbols, None, &mut flat);
        Some(DocumentSymbolResponse::Flat(flat))
    }

    fn folding_ranges(&mut self, params: FoldingRangeParams) -> Option<Vec<lsp_types::FoldingRange>> {
        let document = self.documents.get_mut(&params.text_document.uri)?;
        let root = document.parse().syntax();
        let folds = folding_ranges(&root, &document.text, &document.index);
        Some(folds.iter().map(convert::folding_range).collect())
    }

    fn selection_ranges(&mut self, params: SelectionRangeParams) -> Option<Vec<lsp_types::SelectionRange>> {
        let encoding = self.encoding;
        let document = self.documents.get_mut(&params.text_document.uri)?;
        let root = document.parse().syntax();
        let mapper = Mapper {
            text: &document.text,
            index: &document.index,
            encoding,
        };
        Some(
            params
                .positions
                .iter()
                .map(|position| convert::selection_chain(&mapper, &selection_ranges(&root, mapper.offset(*position))))
                .collect(),
        )
    }

    fn pull_diagnostics_for(&mut self, params: DocumentDiagnosticParams) -> Option<DocumentDiagnosticReportResult> {
        let items = self.diagnostics_of(&params.text_document.uri).unwrap_or_default();
        Some(DocumentDiagnosticReportResult::Report(DocumentDiagnosticReport::Full(
            RelatedFullDocumentDiagnosticReport {
                related_documents: None,
                full_document_diagnostic_report: FullDocumentDiagnosticReport { result_id: None, items },
            },
        )))
    }

    fn diagnostics_of(&mut self, uri: &Uri) -> Option<Vec<lsp_types::Diagnostic>> {
        let default_level = self.settings.php_version.unwrap_or(PhpVersion::LATEST);
        let encoding = self.encoding;
        let document = self.documents.get_mut(uri)?;
        let level = document.level.unwrap_or(default_level);
        let found = diagnostics(document.parse(), level);
        let mapper = Mapper {
            text: &document.text,
            index: &document.index,
            encoding,
        };
        Some(found.iter().map(|found| mapper.diagnostic(found)).collect())
    }

    fn notification(&mut self, notification: Notification) -> Result<(), BoxError> {
        match notification.method.as_str() {
            DidOpenTextDocument::METHOD => {
                let params: DidOpenTextDocumentParams = serde_json::from_value(notification.params)?;
                let item = params.text_document;
                self.documents.open(item.uri.clone(), item.version, item.text);
                self.request_configuration(&item.uri)?;
                self.mark_dirty(item.uri);
            }
            DidChangeTextDocument::METHOD => {
                let params: DidChangeTextDocumentParams = serde_json::from_value(notification.params)?;
                let uri = params.text_document.uri;
                if let Some(document) = self.documents.get_mut(&uri) {
                    document.apply_changes(params.text_document.version, &params.content_changes, self.encoding);
                    self.mark_dirty(uri);
                }
            }
            DidCloseTextDocument::METHOD => {
                let params: DidCloseTextDocumentParams = serde_json::from_value(notification.params)?;
                let uri = params.text_document.uri;
                self.documents.close(&uri);
                self.dirty.retain(|dirty| *dirty != uri);
                if !self.pull_diagnostics {
                    self.publish(uri, None, Vec::new())?;
                }
            }
            DidChangeConfiguration::METHOD => {
                let params: DidChangeConfigurationParams = serde_json::from_value(notification.params)?;
                self.configuration_changed(&params.settings)?;
            }
            _ => {}
        }
        Ok(())
    }

    /// New settings arrived. A client that answers `workspace/configuration` is asked again for every
    /// document, since its answer may differ per folder; one that only pushes sets the default.
    fn configuration_changed(&mut self, settings: &Value) -> Result<(), BoxError> {
        let pushed = Settings::from_value(settings);
        if pushed.php_version.is_some() || !self.configuration_support {
            self.settings = pushed;
        }
        if self.configuration_support {
            for uri in self.documents.uris() {
                self.request_configuration(&uri)?;
            }
        }
        for uri in self.documents.uris() {
            self.mark_dirty(uri);
        }
        Ok(())
    }

    fn request_configuration(&mut self, uri: &Uri) -> Result<(), BoxError> {
        if !self.configuration_support {
            return Ok(());
        }
        self.next_request_id += 1;
        let id = RequestId::from(self.next_request_id);
        let params = ConfigurationParams {
            items: vec![ConfigurationItem {
                scope_uri: Some(uri.clone()),
                section: Some(SECTION.to_string()),
            }],
        };
        self.pending_configuration.insert(id.clone(), uri.clone());
        self.send(Request::new(id, WorkspaceConfiguration::METHOD.to_string(), params))
    }

    fn response(&mut self, response: Response) -> Result<(), BoxError> {
        let Some(uri) = self.pending_configuration.remove(&response.id) else {
            return Ok(());
        };
        let Some(document) = self.documents.get_mut(&uri) else {
            return Ok(());
        };
        let answer = response
            .response_result
            .ok()
            .and_then(|result| result.as_array().and_then(|items| items.first().cloned()))
            .map(|item| Settings::from_value(&item))
            .and_then(|settings| settings.php_version);
        if document.level != answer {
            document.level = answer;
            self.mark_dirty(uri);
            self.refresh_pulled_diagnostics()?;
        }
        Ok(())
    }

    fn refresh_pulled_diagnostics(&mut self) -> Result<(), BoxError> {
        if self.pull_diagnostics && self.diagnostic_refresh_support {
            self.next_request_id += 1;
            let id = RequestId::from(self.next_request_id);
            self.send(Request::new(id, WorkspaceDiagnosticRefresh::METHOD.to_string(), ()))?;
        }
        Ok(())
    }

    fn mark_dirty(&mut self, uri: Uri) {
        if !self.dirty.contains(&uri) {
            self.dirty.push(uri);
        }
    }

    fn publish_dirty(&mut self) -> Result<(), BoxError> {
        if self.pull_diagnostics {
            self.dirty.clear();
            return Ok(());
        }
        for uri in std::mem::take(&mut self.dirty) {
            let version = self.documents.get_mut(&uri).map(|document| document.version);
            if let Some(items) = self.diagnostics_of(&uri) {
                self.publish(uri, version, items)?;
            }
        }
        Ok(())
    }

    fn publish(&self, uri: Uri, version: Option<i32>, diagnostics: Vec<lsp_types::Diagnostic>) -> Result<(), BoxError> {
        self.send(Notification::new(
            PublishDiagnostics::METHOD.to_string(),
            PublishDiagnosticsParams::new(uri, diagnostics, version),
        ))
    }
}
