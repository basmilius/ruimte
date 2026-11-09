import ComputerUseCore
import Testing

struct TextInsertionTests {
    @Test func aNativeFieldTakesPlainText() {
        #expect(TextInsertion.fits("hello there", role: "AXTextField", insideWebArea: false, settable: true))
        #expect(TextInsertion.fits("x", role: "AXTextArea", insideWebArea: false, settable: true))
    }

    @Test func keysGoWhereAWriteWouldBeWrong() {
        #expect(!TextInsertion.fits("hello", role: "AXTextField", insideWebArea: true, settable: true))
        #expect(!TextInsertion.fits("hello", role: "AXTextField", insideWebArea: false, settable: false))
        #expect(!TextInsertion.fits("hello", role: "AXButton", insideWebArea: false, settable: true))
        #expect(!TextInsertion.fits("hello\n", role: "AXTextArea", insideWebArea: false, settable: true))
        #expect(!TextInsertion.fits("a\tb", role: "AXTextField", insideWebArea: false, settable: true))
    }

    @Test func onlyAnUnchangedValueSendsTheKeys() {
        #expect(TextInsertion.landed(before: "ab", after: "abc"))
        #expect(TextInsertion.landed(before: "1000", after: "1,000"))
        #expect(!TextInsertion.landed(before: "ab", after: "ab"))
        #expect(!TextInsertion.landed(before: "ab", after: nil))
    }
}
