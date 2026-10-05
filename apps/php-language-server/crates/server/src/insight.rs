//! Requests that read one document against the index: signature help, semantic tokens and inlay
//! hints.

use lsp_types::{
    Documentation, MarkupContent, MarkupKind, ParameterInformation, ParameterLabel, SignatureHelp, SignatureHelpParams,
    SignatureInformation,
};
use php_analysis::signature::signature_help;

use crate::convert::Mapper;
use crate::paths::uri_to_path;
use crate::server::Server;

impl Server<'_> {
    pub(crate) fn signature_help(&mut self, params: SignatureHelpParams) -> Option<SignatureHelp> {
        let position = params.text_document_position_params;
        let uri = position.text_document.uri;
        let path = uri_to_path(&uri);
        self.sync_symbols(&uri);
        let encoding = self.encoding;
        let document = self.documents.get_mut(&uri)?;
        let root = document.parse().syntax();
        let offset = u32::from(
            Mapper {
                text: &document.text,
                index: &document.index,
                encoding,
            }
            .offset(position.position),
        );
        let project = match &path {
            Some(path) => self.workspace.project_for(path),
            None => &self.workspace.loose,
        };
        let found = signature_help(&project.index, &root, offset)?;
        let markdown = |text: String| {
            Documentation::MarkupContent(MarkupContent {
                kind: MarkupKind::Markdown,
                value: text,
            })
        };
        let signatures: Vec<SignatureInformation> = found
            .signatures
            .into_iter()
            .map(|signature| SignatureInformation {
                label: signature.label,
                documentation: signature.documentation.map(markdown),
                parameters: Some(
                    signature
                        .parameters
                        .into_iter()
                        .map(|parameter| ParameterInformation {
                            label: ParameterLabel::Simple(parameter.label),
                            documentation: parameter.documentation.map(markdown),
                        })
                        .collect(),
                ),
                active_parameter: signature.active_parameter.map(|active| active as u32),
            })
            .collect();
        let active_parameter = signatures
            .get(found.active_signature)
            .and_then(|signature| signature.active_parameter);
        Some(SignatureHelp {
            signatures,
            active_signature: Some(found.active_signature as u32),
            active_parameter,
        })
    }
}
