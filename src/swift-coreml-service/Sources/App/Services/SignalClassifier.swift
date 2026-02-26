import Foundation

/// Signal classifier using CoreML for inference.
///
/// Currently a placeholder — actual CoreML model integration will be added
/// once sufficient training data has been collected.
class SignalClassifier {
    /// Classify a spectrum signal.
    ///
    /// - Parameters:
    ///   - data: Power spectrum data (stitched from multiple FFT frames)
    ///   - signalArea: "A" or "B"
    /// - Returns: Tuple of (prediction, confidence, probabilities)
    func classify(data: [Float], signalArea: String) -> (String, Double, [String: Double]) {
        // Placeholder: extract basic features and return unknown
        let features = extractFeatures(from: data)
        _ = features // Will be used once model is trained

        return ("unknown", 0.0, ["target": 0.0, "noise": 0.0])
    }

    /// Extract signal features for classification.
    func extractFeatures(from signal: [Float]) -> [String: Double] {
        guard !signal.isEmpty else {
            return [:]
        }

        let count = Double(signal.count)

        // Energy
        let energy = signal.map { Double($0) * Double($0) }.reduce(0, +) / count

        // Mean
        let mean = signal.map { Double($0) }.reduce(0, +) / count

        // Variance
        let variance = signal.map { pow(Double($0) - mean, 2) }.reduce(0, +) / count

        // Spectral centroid (weighted average of frequency bins)
        let magnitude = signal.map { abs(Double($0)) }
        let totalMagnitude = magnitude.reduce(0, +)
        let spectralCentroid: Double
        if totalMagnitude > 0 {
            let weightedSum = magnitude.enumerated().map { Double($0.offset) * $0.element }.reduce(0, +)
            spectralCentroid = weightedSum / totalMagnitude
        } else {
            spectralCentroid = 0
        }

        // Zero crossing rate
        var zeroCrossings = 0
        for i in 1..<signal.count {
            if (signal[i] >= 0 && signal[i - 1] < 0) || (signal[i] < 0 && signal[i - 1] >= 0) {
                zeroCrossings += 1
            }
        }
        let zeroCrossingRate = Double(zeroCrossings) / count

        return [
            "energy": energy,
            "mean": mean,
            "variance": variance,
            "spectral_centroid": spectralCentroid,
            "zero_crossing_rate": zeroCrossingRate,
        ]
    }
}
