import Fluent
import Vapor

final class HeterodyningResult: Model, Content {
    static let schema = "heterodyning_results"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "signal_area")
    var signalArea: String

    @Field(key: "is_heterodyning_detected")
    var isHeterodyningDetected: Bool

    @Field(key: "confidence")
    var confidence: Double

    @Field(key: "carrier_frequencies")
    var carrierFrequencies: [Double]

    @Field(key: "intermediate_frequency")
    var intermediateFrequency: Double?

    @Field(key: "modulation_type")
    var modulationType: String?

    @Field(key: "frequency_features")
    var frequencyFeatures: [String: Double]

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
        signalArea: String,
        isHeterodyningDetected: Bool,
        confidence: Double,
        carrierFrequencies: [Double],
        intermediateFrequency: Double?,
        modulationType: String?,
        frequencyFeatures: [String: Double],
        processingTimeMs: Double,
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) {
        self.id = id
        self.signalArea = signalArea
        self.isHeterodyningDetected = isHeterodyningDetected
        self.confidence = confidence
        self.carrierFrequencies = carrierFrequencies
        self.intermediateFrequency = intermediateFrequency
        self.modulationType = modulationType
        self.frequencyFeatures = frequencyFeatures
        self.processingTimeMs = processingTimeMs
        self.frequencyMin = frequencyMin
        self.frequencyMax = frequencyMax
        self.sampleRate = Int(sampleRate)
    }
}
