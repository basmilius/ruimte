import CryptoKit
import Foundation

/// The secret the daemon keeps in `$RUIMTE_HOME/local.key` (`apps/server/src/auth/local-secret.ts`).
/// Reading that file is what proves a caller is this Ruimte, so the helper asks for nothing less.
public enum LocalSecret {
    public static func read(at path: String) -> String? {
        guard let data = FileManager.default.contents(atPath: path) else {
            return nil
        }
        let secret = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return secret.isEmpty ? nil : secret
    }

    /// Compares in constant time; hashing first keeps a length difference from ending the compare early.
    public static func matches(_ presented: String, _ secret: String) -> Bool {
        let left = Array(SHA256.hash(data: Data(presented.utf8)))
        let right = Array(SHA256.hash(data: Data(secret.utf8)))
        var difference: UInt8 = 0
        for i in 0..<left.count {
            difference |= left[i] ^ right[i]
        }
        return difference == 0
    }
}
