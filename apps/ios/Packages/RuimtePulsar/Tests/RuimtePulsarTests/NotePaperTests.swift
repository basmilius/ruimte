import Testing

@testable import RuimtePulsar

@Test func aNoteReadsItsOldPaperBeforeItsAccentAndTheDefaultWithoutEither() {
    #expect(
        ["yellow", "green", "blue", "pink", "gray"].map { RuimteColors.notePaper(accent: nil, color: $0) } == [
            "yellow", "green", "blue", "pink", "neutral",
        ])
    #expect(RuimteColors.notePaper(accent: "red", color: "green") == "green")
    #expect(RuimteColors.notePaper(accent: "teal", color: "chartreuse") == "teal")
    #expect(RuimteColors.notePaper(accent: "#ff0000", color: nil) == nil)
    #expect(RuimteColors.notePaper(accent: "", color: "") == nil)
    for accent in RuimteColors.nodeAccentNames {
        #expect(RuimteColors.notePaper(accent: accent, color: nil) == accent)
    }
}

@Test func everyAccentHasAPaperAndTheOldSheetsKeepTheirValues() {
    #expect(RuimteColors.nodeAccentNames.count == 17)
    #expect(Set(RuimteColors.nodeAccentNames) == Set(RuimteColors.nodeAccents.keys))
    #expect(Set(RuimteColors.notePapers.keys) == Set(RuimteColors.nodeAccentNames + ["neutral"]))
    #expect(RuimteColors.notePapers["yellow"] == RuimteColorToken(light: 0xfff3bf, dark: 0x3b3416))
    #expect(RuimteColors.notePapers["green"] == RuimteColorToken(light: 0xdcf5e3, dark: 0x173a25))
    #expect(RuimteColors.notePapers["blue"] == RuimteColorToken(light: 0xdbe9ff, dark: 0x182f4b))
    #expect(RuimteColors.notePapers["pink"] == RuimteColorToken(light: 0xfde2ea, dark: 0x43212c))
    #expect(RuimteColors.notePapers["neutral"] == RuimteColorToken(light: 0xececef, dark: 0x26262d))
    #expect(RuimteColors.notePaperToken(accent: nil, color: nil) == RuimteColors.notePapers["yellow"])
}
