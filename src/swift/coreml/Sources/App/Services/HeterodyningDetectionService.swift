import Foundation
import Fluent

/// Heterodyning detection service using ML to identify heterodyning patterns in radio signals.
class HeterodyningDetectionService {
    
    /// Detect heterodyning patterns in signal data.
    ///
    /// - Parameters:
    ///   - data: Power spectrum data from FFT processing
    ///   - signalArea: "A" or "B" signal area identifier
    ///   - frequencyMin: Minimum frequency of the signal range
    ///   - frequencyMax: Maximum frequency of the signal range
    ///   - sampleRate: Sample rate of the signal
    /// - Returns: Tuple of (heterodyning result, frequency features)
    func detectHeterodyning(
        data: [Float], 
        signalArea: String, 
        frequencyMin: Double, 
        frequencyMax: Double, 
        sampleRate: UInt32
    ) -> (HeterodyningResult, FrequencyFeatures) {
        let startTime = Date()
        
        // Extract frequency features for analysis
        let frequencyFeatures = extractFrequencyFeatures(
            data: data,
            signalArea: signalArea,
            frequencyMin: frequencyMin,
            frequencyMax: frequencyMax,
            sampleRate: sampleRate
        )
        
        // Perform heterodyning detection
        let (isDetected, confidence, carrierFreqs, intermediateFreq, modulationType) = analyzeHeterodyningPatterns(
            data: data,
            frequencyFeatures: frequencyFeatures,
            frequencyMin: frequencyMin,
            frequencyMax: frequencyMax,
            sampleRate: sampleRate
        )
        
        let processingTime = Date().timeIntervalSince(startTime) * 1000
        
        // Create heterodyning result
        let result = HeterodyningResult(
            signalArea: signalArea,
            isHeterodyningDetected: isDetected,
            confidence: confidence,
            carrierFrequencies: carrierFreqs,
            intermediateFrequency: intermediateFreq,
            modulationType: modulationType,
            frequencyFeatures: [
                "spectral_coherence": frequencyFeatures.phaseCoherence,
                "frequency_stability": frequencyFeatures.frequencyStability,
                "harmonic_content": Double(frequencyFeatures.harmonics.count),
                "peak_count": Double(frequencyFeatures.frequencyPeaks.count),
                "spectral_rolloff": frequencyFeatures.spectralRolloff,
                "spectral_flux": frequencyFeatures.spectralFlux
            ],
            processingTimeMs: processingTime,
            frequencyMin: frequencyMin,
            frequencyMax: frequencyMax,
            sampleRate: sampleRate
        )
        
        return (result, frequencyFeatures)
    }

    /// Extract comprehensive frequency features from signal data.
    private func extractFrequencyFeatures(
        data: [Float],
        signalArea: String,
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) -> FrequencyFeatures {
        guard !data.isEmpty else {
            return FrequencyFeatures(
                signalArea: signalArea,
                dominantFrequencies: [],
                frequencyPeaks: [],
                spectralRolloff: 0.0,
                spectralFlux: 0.0,
                fundamentalFrequency: nil,
                harmonics: [],
                powerDistribution: [],
                phaseCoherence: 0.0,
                frequencyStability: 0.0,
                frequencyMin: frequencyMin,
                frequencyMax: frequencyMax,
                sampleRate: sampleRate
            )
        }
        
        let magnitude = data.map { abs(Double($0)) }
        let count = Double(data.count)
        
        // Find dominant frequencies (top 5 peaks)
        let indexedMagnitude = magnitude.enumerated().sorted { $0.element > $1.element }
        let dominantIndices = Array(indexedMagnitude.prefix(5).map { $0.offset })
        let dominantFrequencies = dominantIndices.map { index in
            frequencyMin + (Double(index) / count) * (frequencyMax - frequencyMin)
        }
        
        // Find all significant peaks (above threshold)
        let threshold = magnitude.reduce(0, +) / count * 2.0 // 2x average magnitude
        let frequencyPeaks = magnitude.enumerated().compactMap { index, value in
            if value > threshold {
                return frequencyMin + (Double(index) / count) * (frequencyMax - frequencyMin)
            }
            return nil
        }
        
        // Calculate spectral rolloff (frequency containing 85% of energy)
        let totalEnergy = magnitude.reduce(0, +)
        var accumulatedEnergy = 0.0
        var rolloffIndex = 0
        for (index, value) in magnitude.enumerated() {
            accumulatedEnergy += value
            if accumulatedEnergy >= totalEnergy * 0.85 {
                rolloffIndex = index
                break
            }
        }
        let spectralRolloff = frequencyMin + (Double(rolloffIndex) / count) * (frequencyMax - frequencyMin)
        
        // Calculate spectral flux (change in spectrum)
        let spectralFlux = calculateSpectralFlux(magnitude: magnitude)
        
        // Find fundamental frequency (lowest dominant frequency)
        let fundamentalFrequency = dominantFrequencies.min()
        
        // Find harmonics (multiples of fundamental frequency)
        let harmonics = findHarmonics(
            dominantFrequencies: dominantFrequencies,
            fundamental: fundamentalFrequency,
            tolerance: (frequencyMax - frequencyMin) / count
        )
        
        // Calculate power distribution across frequency bands
        let powerDistribution = calculatePowerDistribution(magnitude: magnitude)
        
        // Calculate phase coherence (placeholder - would need phase data)
        let phaseCoherence = calculatePhaseCoherence(magnitude: magnitude)
        
        // Calculate frequency stability
        let frequencyStability = calculateFrequencyStability(dominantFrequencies: dominantFrequencies)
        
        return FrequencyFeatures(
            signalArea: signalArea,
            dominantFrequencies: dominantFrequencies,
            frequencyPeaks: frequencyPeaks,
            spectralRolloff: spectralRolloff,
            spectralFlux: spectralFlux,
            fundamentalFrequency: fundamentalFrequency,
            harmonics: harmonics,
            powerDistribution: powerDistribution,
            phaseCoherence: phaseCoherence,
            frequencyStability: frequencyStability,
            frequencyMin: frequencyMin,
            frequencyMax: frequencyMax,
            sampleRate: sampleRate
        )
    }

    /// Analyze signal for heterodyning patterns.
    private func analyzeHeterodyningPatterns(
        data: [Float],
        frequencyFeatures: FrequencyFeatures,
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) -> (Bool, Double, [Double], Double?, String?) {
        
        // Heterodyning indicators
        let hasMultipleCarriers = frequencyFeatures.dominantFrequencies.count >= 2
        let hasHarmonics = !frequencyFeatures.harmonics.isEmpty
        let highCoherence = frequencyFeatures.phaseCoherence > 0.7
        let stableFrequencies = frequencyFeatures.frequencyStability > 0.8
        
        // Check for intermediate frequency patterns
        let intermediateFreq = findIntermediateFrequency(
            carriers: frequencyFeatures.dominantFrequencies,
            tolerance: (frequencyMax - frequencyMin) / Double(data.count)
        )
        
        // Determine modulation type based on patterns
        let modulationType = determineModulationType(
            frequencyFeatures: frequencyFeatures,
            hasIntermediateFreq: intermediateFreq != nil
        )
        
        // Calculate confidence based on multiple factors
        var confidence = 0.0
        if hasMultipleCarriers { confidence += 0.3 }
        if hasHarmonics { confidence += 0.2 }
        if highCoherence { confidence += 0.3 }
        if stableFrequencies { confidence += 0.2 }
        if intermediateFreq != nil { confidence += 0.2 }
        
        confidence = min(0.95, confidence)
        
        let isDetected = confidence > 0.5
        
        return (isDetected, confidence, frequencyFeatures.dominantFrequencies, intermediateFreq, modulationType)
    }

    // MARK: - Helper Methods
    
    private func calculateSpectralFlux(magnitude: [Double]) -> Double {
        guard magnitude.count > 1 else { return 0.0 }
        
        var flux = 0.0
        for i in 1..<magnitude.count {
            let diff = magnitude[i] - magnitude[i - 1]
            flux += diff > 0 ? diff : 0 // Only positive changes
        }
        
        return flux / Double(magnitude.count - 1)
    }
    
    private func findHarmonics(dominantFrequencies: [Double], fundamental: Double?, tolerance: Double) -> [Double] {
        guard let fundamental = fundamental, fundamental > 0 else { return [] }
        
        var harmonics: [Double] = []
        
        for frequency in dominantFrequencies {
            // Check if frequency is a multiple of fundamental (2x, 3x, 4x, etc.)
            for harmonic in 2...6 {
                let expectedFreq = fundamental * Double(harmonic)
                if abs(frequency - expectedFreq) <= tolerance {
                    harmonics.append(frequency)
                    break
                }
            }
        }
        
        return harmonics
    }
    
    private func calculatePowerDistribution(magnitude: [Double]) -> [Double] {
        let bandCount = 8
        let samplesPerBand = magnitude.count / bandCount
        var powerDistribution: [Double] = []
        
        for band in 0..<bandCount {
            let startIndex = band * samplesPerBand
            let endIndex = min(startIndex + samplesPerBand, magnitude.count)
            let bandPower = Array(magnitude[startIndex..<endIndex]).reduce(0, +)
            powerDistribution.append(bandPower)
        }
        
        return powerDistribution
    }
    
    private func calculatePhaseCoherence(magnitude: [Double]) -> Double {
        // Placeholder for phase coherence calculation
        // Would need actual phase data from complex FFT output
        let energy = magnitude.reduce(0, +)
        let peakEnergy = magnitude.max() ?? 0.0
        
        guard energy > 0 else { return 0.0 }
        return peakEnergy / energy
    }
    
    private func calculateFrequencyStability(dominantFrequencies: [Double]) -> Double {
        guard dominantFrequencies.count >= 2 else { return 1.0 }
        
        // Calculate frequency spacing consistency
        var spacings: [Double] = []
        for i in 1..<dominantFrequencies.count {
            spacings.append(dominantFrequencies[i] - dominantFrequencies[i - 1])
        }
        
        guard !spacings.isEmpty else { return 1.0 }
        
        let meanSpacing = spacings.reduce(0, +) / Double(spacings.count)
        let variance = spacings.map { pow($0 - meanSpacing, 2) }.reduce(0, +) / Double(spacings.count)
        let stdDev = sqrt(variance)
        
        // Higher stability = lower relative standard deviation
        guard meanSpacing > 0 else { return 0.0 }
        return max(0.0, 1.0 - (stdDev / meanSpacing))
    }
    
    private func findIntermediateFrequency(carriers: [Double], tolerance: Double) -> Double? {
        guard carriers.count >= 2 else { return nil }
        
        // Look for intermediate frequency (difference or sum of carriers)
        for i in 0..<carriers.count {
            for j in (i + 1)..<carriers.count {
                let difference = abs(carriers[j] - carriers[i])
                let sum = carriers[i] + carriers[j]
                
                // Check if difference or sum appears as a peak in the spectrum
                for freq in carriers {
                    if abs(freq - difference) <= tolerance || abs(freq - sum) <= tolerance {
                        return freq
                    }
                }
            }
        }
        
        return nil
    }
    
    private func determineModulationType(
        frequencyFeatures: FrequencyFeatures,
        hasIntermediateFreq: Bool
    ) -> String? {
        if hasIntermediateFreq && frequencyFeatures.harmonics.count > 2 {
            return "complex_heterodyning"
        } else if hasIntermediateFreq {
            return "simple_heterodyning"
        } else if frequencyFeatures.harmonics.count > 3 {
            return "harmonic_modulation"
        } else if frequencyFeatures.dominantFrequencies.count == 2 {
            return "dual_carrier"
        } else {
            return "single_carrier"
        }
    }
}
