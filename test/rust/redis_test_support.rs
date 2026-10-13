pub fn redis_test_url() -> String {
  std::env::var("REDIS_ADMIN_URL")
    .or_else(|_| std::env::var("REDIS_URL"))
    .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string())
}
