import Vapor
import Fluent

func routes(_ app: Application) throws {
    let api = app.grouped("api", "v1")
    
    // Service instances
    let signalDecodingService = SignalDecodingService()
    let heterodyningDetectionService = HeterodyningDetectionService()
    let signalRecreationService = SignalRecreationService()

    // Training endpoints
    api.post("training", "sample") { req async throws -> TrainingResponse in
        let input = try req.content.decode(TrainingSampleInput.self)

        let sample = TrainingSample(
            signalArea: input.signalArea,
            label: input.label,
            data: input.data,
            frequencyMin: input.frequencyMin,
            frequencyMax: input.frequencyMax,
            sampleRate: input.sampleRate
        )
        try await sample.save(on: req.db)

        let totalSamples = try await TrainingSample.query(on: req.db).count()

        return TrainingResponse(
            success: true,
            sampleId: sample.id?.uuidString,
            totalSamples: UInt64(totalSamples)
        )
    }

    api.post("training", "start") { req async throws -> TrainingStatusResponse in
        // Placeholder: trigger model training
        let totalSamples = try await TrainingSample.query(on: req.db).count()
        let targetSamples = try await TrainingSample.query(on: req.db)
            .filter(\.$label == "target").count()
        let noiseSamples = try await TrainingSample.query(on: req.db)
            .filter(\.$label == "noise").count()

        return TrainingStatusResponse(
            totalSamples: UInt64(totalSamples),
            targetSamples: UInt64(targetSamples),
            noiseSamples: UInt64(noiseSamples),
            modelVersion: nil,
            modelAccuracy: nil,
            isTraining: false
        )
    }

    api.get("training", "status") { req async throws -> TrainingStatusResponse in
        let totalSamples = try await TrainingSample.query(on: req.db).count()
        let targetSamples = try await TrainingSample.query(on: req.db)
            .filter(\.$label == "target").count()
        let noiseSamples = try await TrainingSample.query(on: req.db)
            .filter(\.$label == "noise").count()

        let activeModel = try await ModelVersion.query(on: req.db)
            .filter(\.$isActive == true)
            .first()

        return TrainingStatusResponse(
            totalSamples: UInt64(totalSamples),
            targetSamples: UInt64(targetSamples),
            noiseSamples: UInt64(noiseSamples),
            modelVersion: activeModel?.version,
            modelAccuracy: activeModel?.accuracy,
            isTraining: false
        )
    }

    // Classification endpoint
    api.post("classify") { req async throws -> ClassificationResponse in
        let input = try req.content.decode(ClassificationInput.self)
        let startTime = Date()

        // Placeholder classification — returns dummy result until model is trained
        let processingTimeMs = Date().timeIntervalSince(startTime) * 1000

        return ClassificationResponse(
            prediction: "unknown",
            confidence: 0.0,
            probabilities: ["target": 0.0, "noise": 0.0],
            processingTimeMs: processingTimeMs
        )
    }

    // MARK: - Signal Decoding Endpoints
    
    api.post("decode") { req async throws -> DecodingResponse in
        let input = try req.content.decode(DecodingInput.self)
        
        let (decodedSignal, signalFeatures, confidence) = signalDecodingService.decodeSignal(
            data: input.data,
            signalArea: input.signalArea,
            frequencyMin: input.frequencyMin,
            frequencyMax: input.frequencyMax,
            sampleRate: input.sampleRate
        )
        
        // Save results to database
        try await decodedSignal.save(on: req.db)
        try await signalFeatures.save(on: req.db)
        
        return DecodingResponse(
            decodedSignalId: decodedSignal.id?.uuidString,
            signalFeaturesId: signalFeatures.id?.uuidString,
            prediction: decodedSignal.prediction,
            confidence: confidence,
            decodedFeatures: decodedSignal.decodedFeatures,
            processingTimeMs: decodedSignal.processingTimeMs
        )
    }
    
    api.get("decode", "history") { req async throws -> [DecodedSignal] in
        let signals = try await DecodedSignal.query(on: req.db)
            .sort(\.$createdAt, .descending)
            .limit(50)
            .all()
        return signals
    }

    // MARK: - Heterodyning Detection Endpoints
    
    api.post("heterodyning", "detect") { req async throws -> HeterodyningDetectionResponse in
        let input = try req.content.decode(HeterodyningInput.self)
        
        let (heterodyningResult, frequencyFeatures) = heterodyningDetectionService.detectHeterodyning(
            data: input.data,
            signalArea: input.signalArea,
            frequencyMin: input.frequencyMin,
            frequencyMax: input.frequencyMax,
            sampleRate: input.sampleRate
        )
        
        // Save results to database
        try await heterodyningResult.save(on: req.db)
        try await frequencyFeatures.save(on: req.db)
        
        return HeterodyningDetectionResponse(
            heterodyningResultId: heterodyningResult.id?.uuidString,
            frequencyFeaturesId: frequencyFeatures.id?.uuidString,
            isHeterodyningDetected: heterodyningResult.isHeterodyningDetected,
            confidence: heterodyningResult.confidence,
            carrierFrequencies: heterodyningResult.carrierFrequencies,
            intermediateFrequency: heterodyningResult.intermediateFrequency,
            modulationType: heterodyningResult.modulationType,
            processingTimeMs: heterodyningResult.processingTimeMs
        )
    }
    
    api.get("heterodyning", "status") { req async throws -> HeterodyningStatusResponse in
        let recentResults = try await HeterodyningResult.query(on: req.db)
            .sort(\.$createdAt, .descending)
            .limit(10)
            .all()
        
        let latestResult = recentResults.first
        
        return HeterodyningStatusResponse(
            lastDetectionTime: latestResult?.createdAt,
            isCurrentlyDetected: latestResult?.isHeterodyningDetected ?? false,
            recentDetections: recentResults.map { $0.isHeterodyningDetected },
            averageConfidence: recentResults.isEmpty ? 0.0 : recentResults.map { $0.confidence }.reduce(0, +) / Double(recentResults.count)
        )
    }

    // MARK: - Signal Recreation Endpoints
    
    api.post("recreation", "analyze") { req async throws -> RecreationAnalysisResponse in
        let input = try req.content.decode(RecreationAnalysisInput.self)
        
        let (signalParameters, confidence) = signalRecreationService.analyzeSignalForRecreation(
            data: input.data,
            signalArea: input.signalArea,
            frequencyMin: input.frequencyMin,
            frequencyMax: input.frequencyMax,
            sampleRate: input.sampleRate
        )
        
        // Save parameters to database
        try await signalParameters.save(on: req.db)
        
        return RecreationAnalysisResponse(
            signalParametersId: signalParameters.id?.uuidString,
            parameters: [
                "amplitude": signalParameters.amplitude,
                "frequency": signalParameters.frequency,
                "phase": signalParameters.phase,
                "modulationIndex": signalParameters.modulationIndex ?? 0.0,
                "carrierFrequency": signalParameters.carrierFrequency ?? 0.0,
                "modulationFrequency": signalParameters.modulationFrequency ?? 0.0,
                "pulseWidth": signalParameters.pulseWidth ?? 0.0,
                "pulseRepetitionFrequency": signalParameters.pulseRepetitionFrequency ?? 0.0,
                "noiseLevel": signalParameters.noiseLevel,
                "signalToNoiseRatio": signalParameters.signalToNoiseRatio,
                "bandwidth": signalParameters.bandwidth,
                "waveformType": signalParameters.waveformType
            ],
            analysisConfidence: confidence
        )
    }
    
    api.post("recreation", "generate") { req async throws -> RecreationGenerateResponse in
        let input = try req.content.decode(RecreationGenerateInput.self)
        
        // Retrieve signal parameters from database
        guard let signalParametersId = input.signalParametersId,
              let uuid = UUID(uuidString: signalParametersId),
              let signalParameters = try await SignalParameters.find(uuid, on: req.db) else {
            throw Abort(.badRequest, reason: "Invalid signal parameters ID")
        }
        
        let (waveformPattern, qualityScore) = signalRecreationService.generateRecreatedSignal(
            parameters: signalParameters,
            sampleRate: input.sampleRate,
            duration: input.duration
        )
        
        // Create recreated signal record
        let recreatedSignal = RecreatedSignal(
            originalSignalId: uuid,
            signalParameters: [
                "amplitude": signalParameters.amplitude,
                "frequency": signalParameters.frequency,
                "phase": signalParameters.phase,
                "waveformType": signalParameters.waveformType
            ],
            waveformPattern: waveformPattern,
            recreationQualityScore: qualityScore,
            parameterEstimates: [
                "estimatedAmplitude": signalParameters.amplitude,
                "estimatedFrequency": signalParameters.frequency,
                "estimatedPhase": signalParameters.phase
            ],
            analysisConfidence: 0.85, // Placeholder
            processingTimeMs: 150.0, // Placeholder
            frequencyMin: signalParameters.frequencyMin,
            frequencyMax: signalParameters.frequencyMax,
            sampleRate: input.sampleRate
        )
        
        try await recreatedSignal.save(on: req.db)
        
        return RecreationGenerateResponse(
            recreatedSignalId: recreatedSignal.id?.uuidString,
            waveformPattern: waveformPattern,
            recreationQualityScore: qualityScore,
            processingTimeMs: recreatedSignal.processingTimeMs
        )
    }
    
    api.get("recreation", "library") { req async throws -> [RecreatedSignal] in
        let signals = try await RecreatedSignal.query(on: req.db)
            .sort(\.$createdAt, .descending)
            .limit(20)
            .all()
        return signals
    }
}

// MARK: - Request / Response DTOs

struct TrainingSampleInput: Content {
    let signalArea: String
    let label: String
    let data: [Float]
    let timestamp: Int64?
    let frequencyMin: Double
    let frequencyMax: Double
    let sampleRate: UInt32
}

struct TrainingResponse: Content {
    let success: Bool
    let sampleId: String?
    let totalSamples: UInt64?
}

struct ClassificationInput: Content {
    let data: [Float]
    let signalArea: String
    let frequencyMin: Double
    let frequencyMax: Double
    let timestamp: Int64?
}

struct ClassificationResponse: Content {
    let prediction: String
    let confidence: Double
    let probabilities: [String: Double]
    let processingTimeMs: Double
}

struct TrainingStatusResponse: Content {
    let totalSamples: UInt64
    let targetSamples: UInt64
    let noiseSamples: UInt64
    let modelVersion: String?
    let modelAccuracy: Double?
    let isTraining: Bool
}

// MARK: - Signal Decoding DTOs

struct DecodingInput: Content {
    let data: [Float]
    let signalArea: String
    let frequencyMin: Double
    let frequencyMax: Double
    let sampleRate: UInt32
    let timestamp: Int64?
}

struct DecodingResponse: Content {
    let decodedSignalId: String?
    let signalFeaturesId: String?
    let prediction: String
    let confidence: Double
    let decodedFeatures: [String: Double]
    let processingTimeMs: Double
}

// MARK: - Heterodyning Detection DTOs

struct HeterodyningInput: Content {
    let data: [Float]
    let signalArea: String
    let frequencyMin: Double
    let frequencyMax: Double
    let sampleRate: UInt32
    let timestamp: Int64?
}

struct HeterodyningDetectionResponse: Content {
    let heterodyningResultId: String?
    let frequencyFeaturesId: String?
    let isHeterodyningDetected: Bool
    let confidence: Double
    let carrierFrequencies: [Double]
    let intermediateFrequency: Double?
    let modulationType: String?
    let processingTimeMs: Double
}

struct HeterodyningStatusResponse: Content {
    let lastDetectionTime: Date?
    let isCurrentlyDetected: Bool
    let recentDetections: [Bool]
    let averageConfidence: Double
}

// MARK: - Signal Recreation DTOs

struct RecreationAnalysisInput: Content {
    let data: [Float]
    let signalArea: String
    let frequencyMin: Double
    let frequencyMax: Double
    let sampleRate: UInt32
    let timestamp: Int64?
}

struct RecreationAnalysisResponse: Content {
    let signalParametersId: String?
    let parameters: [String: Double]
    let analysisConfidence: Double
}

struct RecreationGenerateInput: Content {
    let signalParametersId: String
    let sampleRate: UInt32
    let duration: Double
}

struct RecreationGenerateResponse: Content {
    let recreatedSignalId: String?
    let waveformPattern: [Float]
    let recreationQualityScore: Double
    let processingTimeMs: Double
}
