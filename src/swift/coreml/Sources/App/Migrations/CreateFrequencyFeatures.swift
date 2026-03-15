import Fluent
import Vapor

struct CreateFrequencyFeatures: Migration {
    func prepare(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("frequency_features")
            .id()
            .field("signal_area", .string, .required)
            .field("dominant_frequencies", .array(of: .double), .required)
            .field("frequency_peaks", .array(of: .double), .required)
            .field("spectral_rolloff", .double, .required)
            .field("spectral_flux", .double, .required)
            .field("fundamental_frequency", .double)
            .field("harmonics", .array(of: .double), .required)
            .field("power_distribution", .array(of: .double), .required)
            .field("phase_coherence", .double, .required)
            .field("frequency_stability", .double, .required)
            .field("frequency_min", .double, .required)
            .field("frequency_max", .double, .required)
            .field("sample_rate", .int, .required)
            .field("created_at", .datetime)
            .create()
    }

    func revert(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("frequency_features").delete()
    }
}
