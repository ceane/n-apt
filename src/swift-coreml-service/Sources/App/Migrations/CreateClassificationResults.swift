import Fluent

struct CreateClassificationResults: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("classification_results")
            .id()
            .field("sample_id", .uuid, .references("training_samples", "id"))
            .field("prediction", .string, .required)
            .field("confidence", .double, .required)
            .field("processing_time_ms", .double)
            .field("created_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("classification_results").delete()
    }
}
