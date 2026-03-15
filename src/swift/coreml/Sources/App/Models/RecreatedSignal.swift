import Fluent
import Vapor

final class RecreatedSignal: Model, Content {
    static let schema = "recreated_signals"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "original_signal_id")
    var originalSignalId: UUID?

    @Field(key: "signal_parameters")
    var signalParameters: [String: Double]

    @Field(key: "waveform_pattern")
    var waveformPattern: [Float]

    @Field(key: "recreation_quality_score")
    var recreationQualityScore: Double

    @Field(key: "parameter_estimates")
    var parameterEstimates: [String: Double]

    @Field(key: "analysis_confidence")
    var analysisConfidence: Double

    @Field(key: "processing_time_ms")
    var processingTimeMs: Double

    @Field(key: "frequency_min")
    var frequencyMin: Double

    @Field(key: "frequency_max")
    var frequencyMax: Double

    @Field(key: "sample_rate")
    var sampleRate: Int

    @Timestamp(key: "created_at", on: .create)
    var createdAt: Date?

    init() {}

    init(
        id: UUID? = nil,
        originalSignalId: UUID?,
        signalParameters: [String: Double],
        waveformPattern: [Float],
        recreationQualityScore: Double,
        parameterEstimates: [String: Double],
        analysisConfidence: Double,
        processingTimeMs: Double,
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) {
        self.id = id
        self.originalSignalId = originalSignalId
        self.signalParameters = signalParameters
        self.waveformPattern = waveformPattern
        self.recreationQualityScore = recreationQualityScore
        self.parameterEstimates = parameterEstimates
        self.analysisConfidence = analysisConfidence
        self.processingTimeMs = processingTimeMs
        self.frequencyMin = frequencyMin
        self.frequencyMax = frequencyMax
        self.sampleRate = Int(sampleRate)
    }
}
