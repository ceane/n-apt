import Fluent
import Vapor

struct CreateSignalFeatures: Migration {
    func prepare(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("signal_features")
            .id()
            .field("signal_area", .string, .required)
            .field("energy", .double, .required)
            .field("mean", .double, .required)
            .field("variance", .double, .required)
            .field("spectral_centroid", .double, .required)
            .field("zero_crossing_rate", .double, .required)
            .field("peak_frequency", .double, .required)
            .field("bandwidth", .double, .required)
            .field("signal_to_noise_ratio", .double, .required)
            .field("frequency_min", .double, .required)
            .field("frequency_max", .double, .required)
            .field("sample_rate", .int, .required)
            .field("created_at", .datetime)
            .create()
    }

    func revert(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("signal_features").delete()
    }
}
