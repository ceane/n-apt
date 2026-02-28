import Foundation
import Fluent

/// Signal decoding service using CoreML for advanced signal analysis and feature extraction.
class SignalDecodingService {
    let classifier = SignalClassifier()

    /// Decode a signal using advanced ML techniques.
    ///
    /// - Parameters:
    ///   - data: Power spectrum data from FFT processing
    ///   - signalArea: "A" or "B" signal area identifier
    ///   - frequencyMin: Minimum frequency of the signal range
    ///   - frequencyMax: Maximum frequency of the signal range
    ///   - sampleRate: Sample rate of the signal
    /// - Returns: Tuple of (decoded signal, features, confidence)
    func decodeSignal(
        data: [Float], 
        signalArea: String, 
        frequencyMin: Double, 
        frequencyMax: Double, 
        sampleRate: UInt32
    ) -> (DecodedSignal, SignalFeatures, Double) {
        let startTime = Date()
        
        // Extract basic features using existing classifier
        let basicFeatures = classifier.extractFeatures(from: data)
        
        // Perform advanced signal decoding
        let decodedFeatures = performAdvancedDecoding(data: data, basicFeatures: basicFeatures)
        
        // Generate prediction based on decoded features
        let (prediction, confidence) = generatePrediction(from: decodedFeatures)
        
        // Create comprehensive signal features
        let signalFeatures = createSignalFeatures(
            data: data,
            basicFeatures: basicFeatures,
            decodedFeatures: decodedFeatures,
            signalArea: signalArea,
            frequencyMin: frequencyMin,
            frequencyMax: frequencyMax,
            sampleRate: sampleRate
        )
        
        let processingTime = Date().timeIntervalSince(startTime) * 1000
        
        // Create decoded signal result
        let decodedSignal = DecodedSignal(
            signalArea: signalArea,
            originalData: data,
            decodedFeatures: decodedFeatures,
            prediction: prediction,
            confidence: confidence,
            processingTimeMs: processingTime,
            frequencyMin: frequencyMin,
            frequencyMax: frequencyMax,
            sampleRate: sampleRate
        )
        
        return (decodedSignal, signalFeatures, confidence)
    }

    /// Perform advanced signal decoding analysis.
    private func performAdvancedDecoding(data: [Float], basicFeatures: [String: Double]) -> [String: Double] {
        var features = basicFeatures
        
        guard !data.isEmpty else { return features }
        
        let count = Double(data.count)
        
        // Advanced spectral analysis
        let magnitude = data.map { abs(Double($0)) }
        let sortedMagnitude = magnitude.sorted()
        
        // Percentile-based analysis
        let p10 = sortedMagnitude[Int(count * 0.1)]
        let p25 = sortedMagnitude[Int(count * 0.25)]
        let p75 = sortedMagnitude[Int(count * 0.75)]
        let p90 = sortedMagnitude[Int(count * 0.9)]
        
        features["spectral_skewness"] = calculateSkewness(data: magnitude)
        features["spectral_kurtosis"] = calculateKurtosis(data: magnitude)
        features["spectral_spread"] = p75 - p25
        features["dynamic_range"] = sortedMagnitude.last! - sortedMagnitude.first!
        features["peak_to_average_ratio"] = sortedMagnitude.last! / (magnitude.reduce(0, +) / count)
        
        // Frequency domain features
        features["high_frequency_energy"] = magnitude.suffix(Int(count * 0.2)).reduce(0, +) / (count * 0.2)
        features["low_frequency_energy"] = magnitude.prefix(Int(count * 0.2)).reduce(0, +) / (count * 0.2)
        features["frequency_balance"] = features["high_frequency_energy"]! / features["low_frequency_energy"]!
        
        // Signal complexity metrics
        features["spectral_entropy"] = calculateSpectralEntropy(magnitude: magnitude)
        features["signal_complexity"] = calculateSignalComplexity(data: data)
        
        return features
    }

    /// Generate prediction based on decoded features.
    private func generatePrediction(from features: [String: Double]) -> (String, Double) {
        // Placeholder ML logic - will be replaced with actual CoreML model
        let energy = features["energy"] ?? 0.0
        let snr = features["signal_to_noise_ratio"] ?? 0.0
        let complexity = features["signal_complexity"] ?? 0.0
        
        // Simple heuristic-based classification
        if energy > 0.5 && snr > 10 && complexity > 0.3 {
            return ("n_apt_signal", min(0.95, energy + snr / 100))
        } else if energy > 0.2 && snr > 5 {
            return ("potential_signal", min(0.8, energy + snr / 100))
        } else {
            return ("noise", max(0.1, 1.0 - energy))
        }
    }

    /// Create comprehensive signal features for database storage.
    private func createSignalFeatures(
        data: [Float],
        basicFeatures: [String: Double],
        decodedFeatures: [String: Double],
        signalArea: String,
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) -> SignalFeatures {
        // Find peak frequency
        let magnitude = data.map { abs(Double($0)) }
        let peakIndex = magnitude.enumerated().max(by: { $0.element < $1.element })?.offset ?? 0
        let peakFrequency = frequencyMin + (Double(peakIndex) / Double(data.count)) * (frequencyMax - frequencyMin)
        
        // Calculate bandwidth (frequency range containing 90% of energy)
        let sortedMagnitude = magnitude.enumerated().sorted { $0.element > $1.element }
        let energyThreshold = magnitude.reduce(0, +) * 0.9
        var accumulatedEnergy = 0.0
        var bandwidthIndices: [Int] = []
        
        for (index, value) in sortedMagnitude {
            accumulatedEnergy += value
            bandwidthIndices.append(index)
            if accumulatedEnergy >= energyThreshold {
                break
            }
        }
        
        let bandwidth = bandwidthIndices.isEmpty ? 0.0 : 
            (Double(bandwidthIndices.max()! - bandwidthIndices.min()!) / Double(data.count)) * (frequencyMax - frequencyMin)
        
        return SignalFeatures(
            signalArea: signalArea,
            energy: basicFeatures["energy"] ?? 0.0,
            mean: basicFeatures["mean"] ?? 0.0,
            variance: basicFeatures["variance"] ?? 0.0,
            spectralCentroid: basicFeatures["spectral_centroid"] ?? 0.0,
            zeroCrossingRate: basicFeatures["zero_crossing_rate"] ?? 0.0,
            peakFrequency: peakFrequency,
            bandwidth: bandwidth,
            signalToNoiseRatio: decodedFeatures["signal_to_noise_ratio"] ?? 0.0,
            frequencyMin: frequencyMin,
            frequencyMax: frequencyMax,
            sampleRate: sampleRate
        )
    }

    // MARK: - Helper Methods
    
    private func calculateSkewness(data: [Double]) -> Double {
        let mean = data.reduce(0, +) / Double(data.count)
        let variance = data.map { pow($0 - mean, 2) }.reduce(0, +) / Double(data.count)
        let stdDev = sqrt(variance)
        
        guard stdDev > 0 else { return 0.0 }
        
        let skewness = data.map { pow(($0 - mean) / stdDev, 3) }.reduce(0, +) / Double(data.count)
        return skewness
    }
    
    private func calculateKurtosis(data: [Double]) -> Double {
        let mean = data.reduce(0, +) / Double(data.count)
        let variance = data.map { pow($0 - mean, 2) }.reduce(0, +) / Double(data.count)
        let stdDev = sqrt(variance)
        
        guard stdDev > 0 else { return 0.0 }
        
        let kurtosis = data.map { pow(($0 - mean) / stdDev, 4) }.reduce(0, +) / Double(data.count) - 3.0
        return kurtosis
    }
    
    private func calculateSpectralEntropy(magnitude: [Double]) -> Double {
        let totalMagnitude = magnitude.reduce(0, +)
        guard totalMagnitude > 0 else { return 0.0 }
        
        let probabilities = magnitude.map { $0 / totalMagnitude }
        let entropy = -probabilities.map { $0 > 0 ? $0 * log2($0) : 0 }.reduce(0, +)
        return entropy
    }
    
    private func calculateSignalComplexity(data: [Float]) -> Double {
        // Simple complexity measure based on zero crossings and energy variation
        var zeroCrossings = 0
        for i in 1..<data.count {
            if (data[i] >= 0 && data[i - 1] < 0) || (data[i] < 0 && data[i - 1] >= 0) {
                zeroCrossings += 1
            }
        }
        
        let zeroCrossingRate = Double(zeroCrossings) / Double(data.count)
        let energy = data.map { Double($0 * $0) }.reduce(0, +) / Double(data.count)
        
        return (zeroCrossingRate + energy) / 2.0
    }
}
