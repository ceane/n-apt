import Fluent
import Vapor

struct CreateDecodedSignals: Migration {
    func prepare(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("decoded_signals")
            .id()
            .field("signal_area", .string, .required)
            .field("original_data", .array(of: .float), .required)
            .field("decoded_features", .dictionary(of: .double), .required)
            .field("prediction", .string, .required)
            .field("confidence", .double, .required)
            .field("processing_time_ms", .double, .required)
            .field("frequency_min", .double, .required)
            .field("frequency_max", .double, .required)
            .field("sample_rate", .int, .required)
            .field("created_at", .datetime)
            .create()
    }

    func revert(on database: Database) -> EventLoopFuture<Void> {
        return database.schema("decoded_signals").delete()
    }
}
