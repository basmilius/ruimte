import FoundationModels

@Generable
struct AssistantReply {
    @Guide(description: "False for answers. True only if a necessary user decision is still missing after checking the requested sources. Use file tools first when asked to read files.")
    var needsUserInput: Bool

    @Guide(description: "If needsUserInput is true, one concrete question for the user. Otherwise the answer or completed work summary. Use the user's language.")
    var message: String
}

enum AssistantReplyError: Error, CustomStringConvertible {
    case incomplete
    case tooManyQuestions
    case invalidQuestion

    var description: String {
        switch self {
        case .incomplete: "The model did not complete its response. Try a shorter request."
        case .tooManyQuestions: "The model asked too many follow-up questions in one turn. Please narrow the request."
        case .invalidQuestion: "The model's question was empty or too long for a question card."
        }
    }
}
