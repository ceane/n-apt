import Fluent
import Vapor

final class FrequencyFeatures: Model, Content {
    static let schema = "frequency_features"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "signal_area")
    var signalArea: String

    @Field(key: "dominant_frequencies")
    var dominantFrequencies: [Double]

    @Field(key: "frequency_peaks")
    var frequencyPeaks: [Double]

    @Field(key: "spectral_rolloff")
    var spectralRolloff: Double

    @Field(key: "spectral_flux")
    var spectralFlux: Double

    @Field(key: "fundamental_frequency")
    var fundamentalFrequency: Double?

    @Field(key: "harmonics")
    var harmonics: [Double]

    @Field(key: "power_distribution")
    var powerDistribution: [Double]

    @Field(key: "phase_coherence")
    var phaseCoherence: Double

    @Field(key: "frequency_stability")
    var frequencyStability: Double

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
        dominantFrequencies: [Double],
        frequencyPeaks: [Double],
        spectralRolloff: Double,
        spectralFlux: Double,
        fundamentalFrequency: Double?,
        harmonics: [Double],
        powerDistribution: [Double],
        phaseCoherence: Double,
        frequencyStability: Double,
        frequencyMin: Double,
        frequencyMax: Double,
        sampleRate: UInt32
    ) {
        self.id = id
        self.signalArea = signalArea
        self.dominantFrequencies = dominantFrequencies
        self.frequencyPeaks = frequencyPeaks
        self.spectralRolloff = spectralRolloff
        self.spectralFlux = spectralFlux
        self.fundamentalFrequency = fundamentalFrequency
        self.harmonics = harmonics
        self.powerDistribution = powerDistribution
        self.phaseCoherence = phaseCoherence
        self.frequencyStability = frequencyStability
        self.frequencyMin = frequencyMin
        self.frequencyMax = frequencyMax
        self.sampleRate = Int(sampleRate)
    }
}
