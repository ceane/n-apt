import Fluent

struct CreateModelVersions: AsyncMigration {
    func prepare(on database: Database) async throws {
        try await database.schema("model_versions")
            .id()
            .field("version", .string, .required)
            .field("accuracy", .double)
            .field("precision_target", .double)
            .field("precision_noise", .double)
            .field("recall_target", .double)
            .field("recall_noise", .double)
            .field("training_samples_count", .int)
            .field("is_active", .bool, .required, .custom("DEFAULT FALSE"))
            .field("created_at", .datetime)
            .create()
    }

    func revert(on database: Database) async throws {
        try await database.schema("model_versions").delete()
    }
}
