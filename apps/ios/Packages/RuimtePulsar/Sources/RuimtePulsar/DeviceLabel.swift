func boundedDeviceLabel(_ label: String) -> String {
    var result = ""
    var units = 0
    for scalar in label.unicodeScalars {
        let length = scalar.value > 0xffff ? 2 : 1
        if units + length > 80 {
            break
        }
        result.unicodeScalars.append(scalar)
        units += length
    }
    return result.isEmpty ? "Ruimte" : result
}
