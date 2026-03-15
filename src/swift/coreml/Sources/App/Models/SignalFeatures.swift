import Fluent
import Vapor

final class SignalFeatures: Model, Content {
    static let schema = "signal_features"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "signal_area")
    var signalArea: String

    @Field(key: "energy")
    var energy: Double

    @Field(key: "mean")
    var mean: Double

    @Field(key: "variance")
    var variance: Double

    @Field(key: "spectral_centroid")
    var spectralCentroid: Double

    @Field(key: "zero_crossing_rate")
    var zeroCrossingRate: Double

    @Field(key: "peak_frequency")
    var peakFrequency: Double

    @Field(key: "bandwidth")
    var bandwidth: Double

    @Field(key: "signal_to_noise_ratio")
    var signalToNoiseRatio: Double

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
        energy: Double,
        mean: Double,
        variance: Double,
        spectralCentroid: Double,
        zeroCrossingRate: Double,
        peakFrequency: Double,
        bandwidth: Double,
        signalToNoiseRatio: Double,
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) {
        self.id = id
        self.signalArea = signalArea
        self.energy = energy
        self.mean = mean
        self.variance = variance
        self.spectralCentroid = spectralCentroid
        self.zeroCrossingRate = zeroCrossingRate
        self.peakFrequency = peakFrequency
        self.bandwidth = bandwidth
        self.signalToNoiseRatio = signalToNoiseRatio
        self.frequencyMin = frequencyMin
        self.frequencyMax = frequencyMax
        self.sampleRate = Int(sampleRate)
    }
}
