import Foundation
import Fluent

/// Signal recreation service for analyzing and recreating signal forms using ML.
class SignalRecreationService {
    
    /// Analyze a signal to determine its parameters for recreation.
    ///
    /// - Parameters:
    ///   - data: Power spectrum data from FFT processing
    ///   - signalArea: "A" or "B" signal area identifier
    ///   - frequencyMin: Minimum frequency of the signal range
    ///   - frequencyMax: Maximum frequency of the signal range
    ///   - sampleRate: Sample rate of the signal
    /// - Returns: Tuple of (signal parameters, analysis confidence)
    func analyzeSignalForRecreation(
        data: [Float], 
        signalArea: String, 
        frequencyMin: Double, 
        frequencyMax: Double, 
        sampleRate: UInt32
    ) -> (SignalParameters, Double) {
        let startTime = Date()
        
        // Extract signal parameters from the data
        let parameters = extractSignalParameters(
            data: data,
            signalArea: signalArea,
            frequencyMin: frequencyMin,
            frequencyMax: frequencyMax,
            sampleRate: sampleRate
        )
        
        // Calculate analysis confidence
        let confidence = calculateAnalysisConfidence(
            data: data,
            parameters: parameters
        )
        
        let processingTime = Date().timeIntervalSince(startTime) * 1000
        
        // Store analysis results (in a real implementation, would save to database)
        print("Signal analysis completed in \(processingTime)ms with confidence: \(confidence)")
        
        return (parameters, confidence)
    }

    /// Generate a recreated signal based on analyzed parameters.
    ///
    /// - Parameters:
    ///   - parameters: Signal parameters from analysis
    ///   - sampleRate: Sample rate for signal generation
    ///   - duration: Duration of signal to generate (in seconds)
    /// - Returns: Tuple of (recreated signal data, quality score)
    func generateRecreatedSignal(
        parameters: SignalParameters,
        sampleRate: UInt32,
        duration: Double
    ) -> ([Float], Double) {
        let startTime = Date()
        let sampleCount = Int(sampleRate) * Int(duration)
        var signalData: [Float] = []
        
        // Generate signal based on waveform type and parameters
        switch parameters.waveformType {
        case "sine":
            signalData = generateSineWave(parameters: parameters, sampleCount: sampleCount, sampleRate: sampleRate)
        case "square":
            signalData = generateSquareWave(parameters: parameters, sampleCount: sampleCount, sampleRate: sampleRate)
        case "sawtooth":
            signalData = generateSawtoothWave(parameters: parameters, sampleCount: sampleCount, sampleRate: sampleRate)
        case "triangle":
            signalData = generateTriangleWave(parameters: parameters, sampleCount: sampleCount, sampleRate: sampleRate)
        case "modulated":
            signalData = generateModulatedWave(parameters: parameters, sampleCount: sampleCount, sampleRate: sampleRate)
        case "pulsed":
            signalData = generatePulsedWave(parameters: parameters, sampleCount: sampleCount, sampleRate: sampleRate)
        default:
            signalData = generateComplexWave(parameters: parameters, sampleCount: sampleCount, sampleRate: sampleRate)
        }
        
        // Add noise based on noise level parameter
        signalData = addNoise(signal: signalData, noiseLevel: parameters.noiseLevel)
        
        // Calculate quality score
        let qualityScore = calculateRecreationQuality(
            originalParams: parameters,
            generatedSignal: signalData,
            sampleRate: sampleRate
        )
        
        let processingTime = Date().timeIntervalSince(startTime) * 1000
        print("Signal generation completed in \(processingTime)ms with quality score: \(qualityScore)")
        
        return (signalData, qualityScore)
    }

    /// Extract comprehensive signal parameters from input data.
    private func extractSignalParameters(
        data: [Float],
        signalArea: String,
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) -> SignalParameters {
        guard !data.isEmpty else {
            return SignalParameters(
                signalArea: signalArea,
                amplitude: 0.0,
                frequency: 0.0,
                phase: 0.0,
                modulationIndex: nil,
                carrierFrequency: nil,
                modulationFrequency: nil,
                pulseWidth: nil,
                pulseRepetitionFrequency: nil,
                noiseLevel: 0.0,
                signalToNoiseRatio: 0.0,
                bandwidth: 0.0,
                waveformType: "unknown",
                frequencyMin: frequencyMin,
                frequencyMax: frequencyMax,
                sampleRate: sampleRate
            )
        }
        
        let magnitude = data.map { abs(Double($0)) }
        let count = Double(data.count)
        
        // Basic amplitude and frequency analysis
        let amplitude = magnitude.max() ?? 0.0
        let peakIndex = magnitude.enumerated().max(by: { $0.element < $1.element })?.offset ?? 0
        let frequency = frequencyMin + (Double(peakIndex) / count) * (frequencyMax - frequencyMin)
        
        // Estimate phase (simplified - would need complex FFT data)
        let phase = estimatePhase(data: data, peakIndex: peakIndex)
        
        // Noise and SNR analysis
        let noiseLevel = estimateNoiseLevel(magnitude: magnitude)
        let signalPower = magnitude.filter { $0 > noiseLevel * 2 }.reduce(0, +) / max(1, magnitude.filter { $0 > noiseLevel * 2 }.count)
        let signalToNoiseRatio = signalPower > 0 ? 10 * log10(signalPower / noiseLevel) : 0.0
        
        // Bandwidth calculation
        let bandwidth = calculateSignalBandwidth(magnitude: magnitude, frequencyMin: frequencyMin, frequencyMax: frequencyMax)
        
        // Determine waveform type
        let waveformType = determineWaveformType(magnitude: magnitude, harmonics: findHarmonics(magnitude: magnitude))
        
        // Advanced parameters for complex signals
        let modulationIndex = estimateModulationIndex(magnitude: magnitude)
        let carrierFrequency = estimateCarrierFrequency(magnitude: magnitude, frequencyMin: frequencyMin, frequencyMax: frequencyMax)
        let modulationFrequency = estimateModulationFrequency(magnitude: magnitude, sampleRate: sampleRate)
        let (pulseWidth, pulseRepetitionFrequency) = estimatePulseParameters(magnitude: magnitude, sampleRate: sampleRate)
        
        return SignalParameters(
            signalArea: signalArea,
            amplitude: amplitude,
            frequency: frequency,
            phase: phase,
            modulationIndex: modulationIndex,
            carrierFrequency: carrierFrequency,
            modulationFrequency: modulationFrequency,
            pulseWidth: pulseWidth,
            pulseRepetitionFrequency: pulseRepetitionFrequency,
            noiseLevel: noiseLevel,
            signalToNoiseRatio: signalToNoiseRatio,
            bandwidth: bandwidth,
            waveformType: waveformType,
            frequencyMin: frequencyMin,
            frequencyMax: frequencyMax,
            sampleRate: sampleRate
        )
    }

    // MARK: - Signal Generation Methods
    
    private func generateSineWave(parameters: SignalParameters, sampleCount: Int, sampleRate: UInt32) -> [Float] {
        var signal: [Float] = []
        let angularFrequency = 2 * Double.pi * parameters.frequency / Double(sampleRate)
        
        for i in 0..<sampleCount {
            let time = Double(i) / Double(sampleRate)
            let value = parameters.amplitude * sin(angularFrequency * time + parameters.phase)
            signal.append(Float(value))
        }
        
        return signal
    }
    
    private func generateSquareWave(parameters: SignalParameters, sampleCount: Int, sampleRate: UInt32) -> [Float] {
        var signal: [Float] = []
        let period = Double(sampleRate) / parameters.frequency
        
        for i in 0..<sampleCount {
            let phase = (Double(i) / period).truncatingRemainder(dividingBy: 1.0)
            let value = phase < 0.5 ? parameters.amplitude : -parameters.amplitude
            signal.append(Float(value))
        }
        
        return signal
    }
    
    private func generateSawtoothWave(parameters: SignalParameters, sampleCount: Int, sampleRate: UInt32) -> [Float] {
        var signal: [Float] = []
        let period = Double(sampleRate) / parameters.frequency
        
        for i in 0..<sampleCount {
            let phase = (Double(i) / period).truncatingRemainder(dividingBy: 1.0)
            let value = parameters.amplitude * (2 * phase - 1)
            signal.append(Float(value))
        }
        
        return signal
    }
    
    private func generateTriangleWave(parameters: SignalParameters, sampleCount: Int, sampleRate: UInt32) -> [Float] {
        var signal: [Float] = []
        let period = Double(sampleRate) / parameters.frequency
        
        for i in 0..<sampleCount {
            let phase = (Double(i) / period).truncatingRemainder(dividingBy: 1.0)
            let value = phase < 0.5 ? 
                parameters.amplitude * (4 * phase - 1) : 
                parameters.amplitude * (3 - 4 * phase)
            signal.append(Float(value))
        }
        
        return signal
    }
    
    private func generateModulatedWave(parameters: SignalParameters, sampleCount: Int, sampleRate: UInt32) -> [Float] {
        guard let carrierFreq = parameters.carrierFrequency,
              let modFreq = parameters.modulationFrequency,
              let modIndex = parameters.modulationIndex else {
            return generateSineWave(parameters: parameters, sampleCount: sampleCount, sampleRate: sampleRate)
        }
        
        var signal: [Float] = []
        let carrierAngularFreq = 2 * Double.pi * carrierFreq / Double(sampleRate)
        let modAngularFreq = 2 * Double.pi * modFreq / Double(sampleRate)
        
        for i in 0..<sampleCount {
            let time = Double(i) / Double(sampleRate)
            let modulation = 1 + modIndex * sin(modAngularFreq * time)
            let value = parameters.amplitude * modulation * sin(carrierAngularFreq * time + parameters.phase)
            signal.append(Float(value))
        }
        
        return signal
    }
    
    private func generatePulsedWave(parameters: SignalParameters, sampleCount: Int, sampleRate: UInt32) -> [Float] {
        guard let pulseWidth = parameters.pulseWidth,
              let prf = parameters.pulseRepetitionFrequency else {
            return generateSineWave(parameters: parameters, sampleCount: sampleCount, sampleRate: sampleRate)
        }
        
        var signal: [Float] = []
        let angularFrequency = 2 * Double.pi * parameters.frequency / Double(sampleRate)
        let pulsePeriod = Double(sampleRate) / prf
        let pulseSamples = Int(pulseWidth * Double(sampleRate))
        
        for i in 0..<sampleCount {
            let time = Double(i) / Double(sampleRate)
            let pulsePhase = (Double(i) / pulsePeriod).truncatingRemainder(dividingBy: 1.0)
            
            if pulsePhase < pulseWidth {
                let value = parameters.amplitude * sin(angularFrequency * time + parameters.phase)
                signal.append(Float(value))
            } else {
                signal.append(0.0)
            }
        }
        
        return signal
    }
    
    private func generateComplexWave(parameters: SignalParameters, sampleCount: Int, sampleRate: UInt32) -> [Float] {
        // Generate a complex waveform combining multiple components
        var signal = generateSineWave(parameters: parameters, sampleCount: sampleCount, sampleRate: sampleRate)
        
        // Add harmonics
        for harmonic in 2...4 {
            let harmonicParams = SignalParameters(
                signalArea: parameters.signalArea,
                amplitude: parameters.amplitude / Double(harmonic),
                frequency: parameters.frequency * Double(harmonic),
                phase: parameters.phase,
                modulationIndex: nil,
                carrierFrequency: nil,
                modulationFrequency: nil,
                pulseWidth: nil,
                pulseRepetitionFrequency: nil,
                noiseLevel: 0.0,
                signalToNoiseRatio: parameters.signalToNoiseRatio,
                bandwidth: parameters.bandwidth,
                waveformType: "sine",
                frequencyMin: parameters.frequencyMin,
                frequencyMax: parameters.frequencyMax,
                sampleRate: sampleRate
            )
            
            let harmonicSignal = generateSineWave(parameters: harmonicParams, sampleCount: sampleCount, sampleRate: sampleRate)
            for i in 0..<signal.count {
                signal[i] += harmonicSignal[i] * 0.5 // Reduce harmonic contribution
            }
        }
        
        return signal
    }

    // MARK: - Analysis Helper Methods
    
    private func calculateAnalysisConfidence(data: [Float], parameters: SignalParameters) -> Double {
        var confidence = 0.5 // Base confidence
        
        // Higher confidence for stronger signals
        if parameters.amplitude > 0.5 { confidence += 0.2 }
        
        // Higher confidence for better SNR
        if parameters.signalToNoiseRatio > 10 { confidence += 0.2 }
        
        // Higher confidence for clear waveform types
        if parameters.waveformType != "unknown" { confidence += 0.1 }
        
        return min(0.95, confidence)
    }
    
    private func calculateRecreationQuality(originalParams: SignalParameters, generatedSignal: [Float], sampleRate: UInt32) -> Double {
        // Simple quality assessment based on parameter consistency
        var quality = 0.5
        
        // Check amplitude consistency
        let generatedAmplitude = generatedSignal.map { abs(Double($0)) }.max() ?? 0.0
        let amplitudeError = abs(generatedAmplitude - originalParams.amplitude) / max(originalParams.amplitude, 0.001)
        quality += max(0, 0.3 - amplitudeError)
        
        // Check for reasonable signal characteristics
        let generatedEnergy = generatedSignal.map { Double($0 * $0) }.reduce(0, +) / Double(generatedSignal.count)
        if generatedEnergy > 0.01 { quality += 0.2 }
        
        return min(0.95, quality)
    }
    
    private func addNoise(signal: [Float], noiseLevel: Double) -> [Float] {
        return signal.map { sample in
            let noise = Float((Double.random(in: -1...1) * noiseLevel))
            return sample + noise
        }
    }
    
    // MARK: - Parameter Estimation Methods
    
    private func estimatePhase(data: [Float], peakIndex: Int) -> Double {
        // Simplified phase estimation
        return Double.random(in: 0...(2 * Double.pi))
    }
    
    private func estimateNoiseLevel(magnitude: [Double]) -> Double {
        let sortedMagnitude = magnitude.sorted()
        let medianIndex = sortedMagnitude.count / 2
        return sortedMagnitude[medianIndex]
    }
    
    private func calculateSignalBandwidth(magnitude: [Double], frequencyMin: Double, frequencyMax: Double) -> Double {
        let totalEnergy = magnitude.reduce(0, +)
        var accumulatedEnergy = 0.0
        var lowerIndex = 0
        var upperIndex = magnitude.count - 1
        
        // Find lower bound (5% of energy)
        for (index, value) in magnitude.enumerated() {
            accumulatedEnergy += value
            if accumulatedEnergy >= totalEnergy * 0.05 {
                lowerIndex = index
                break
            }
        }
        
        // Find upper bound (95% of energy)
        accumulatedEnergy = 0.0
        for (index, value) in magnitude.enumerated() {
            accumulatedEnergy += value
            if accumulatedEnergy >= totalEnergy * 0.95 {
                upperIndex = index
                break
            }
        }
        
        let lowerFreq = frequencyMin + (Double(lowerIndex) / Double(magnitude.count)) * (frequencyMax - frequencyMin)
        let upperFreq = frequencyMin + (Double(upperIndex) / Double(magnitude.count)) * (frequencyMax - frequencyMin)
        
        return upperFreq - lowerFreq
    }
    
    private func determineWaveformType(magnitude: [Double], harmonics: [Double]) -> String {
        if harmonics.count > 4 {
            return "square"
        } else if harmonics.count > 2 {
            return "sawtooth"
        } else if harmonics.count == 2 {
            return "triangle"
        } else {
            return "sine"
        }
    }
    
    private func findHarmonics(magnitude: [Double]) -> [Double] {
        // Simplified harmonic detection
        let threshold = magnitude.max()! * 0.1
        return magnitude.enumerated().compactMap { index, value in
            value > threshold ? Double(index) : nil
        }
    }
    
    private func estimateModulationIndex(magnitude: [Double]) -> Double? {
        // Placeholder for modulation index estimation
        return magnitude.randomElement().map { Double($0) }
    }
    
    private func estimateCarrierFrequency(magnitude: [Double], frequencyMin: Double, frequencyMax: Double) -> Double? {
        let peakIndex = magnitude.enumerated().max(by: { $0.element < $1.element })?.offset ?? 0
        return frequencyMin + (Double(peakIndex) / Double(magnitude.count)) * (frequencyMax - frequencyMin)
    }
    
    private func estimateModulationFrequency(magnitude: [Double], sampleRate: UInt32) -> Double? {
        // Placeholder for modulation frequency estimation
        return Double(sampleRate) / 1000.0 // 1 kHz default
    }
    
    private func estimatePulseParameters(magnitude: [Double], sampleRate: UInt32) -> (Double?, Double?) {
        // Placeholder for pulse parameter estimation
        return (0.1, 100.0) // 10% pulse width, 100 Hz PRF
    }
}
