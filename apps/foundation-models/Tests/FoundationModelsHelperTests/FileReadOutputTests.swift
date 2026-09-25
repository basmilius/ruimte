import Testing
@testable import FoundationModelsHelper

@Test func readOutputPreservesFileTextWithoutJSONEscaping() {
    let result = FileReadOutput.modelText(##"{"path":"planning.md","offset":0,"totalLines":3,"content":"# Planning\nC:\\notes\n\"quoted\"","nextOffset":null,"truncated":false}"##)
    #expect(result.hasSuffix("# Planning\nC:\\notes\n\"quoted\""))
    #expect(result.contains("nextOffset: null"))
    #expect(!result.contains(#"Planning\n"#))
}

@Test func readOutputKeepsPaginationAndErrors() {
    let result = FileReadOutput.modelText(##"{"path":"notes.md","offset":12,"totalLines":50,"content":"more","nextOffset":22,"truncated":true}"##)
    #expect(result.contains("Line offset: 12. Total lines: 50."))
    #expect(result.contains("nextOffset: 22. Truncated: true."))
    #expect(FileReadOutput.modelText("TOOL ERROR") == "TOOL ERROR")
}
