//! Redis construction boundary.

use redis::aio::MultiplexedConnection;
use serde::de::DeserializeOwned;
use serde::Serialize;

/// Redis is optional for listener readiness. Endpoint-specific code may use
/// this value to defer connection work until it actually needs Redis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedisConfig {
  pub url: String,
}

/// Async Redis operations shared by request handlers and background workers.
/// The client is cheap to clone; network connections are opened only by an
/// operation and are therefore safe to use after listener startup.
#[derive(Clone)]
pub struct RedisStore {
  client: redis::Client,
  config_error: Option<String>,
}

pub struct RedisDatabase {
  connection: MultiplexedConnection,
}

impl RedisDatabase {
  pub async fn query<T, F>(
    &mut self,
    command: &str,
    configure: F,
  ) -> Result<T, String>
  where
    T: redis::FromRedisValue,
    F: FnOnce(&mut redis::Cmd),
  {
    let command_name = command.to_string();
    let mut command = redis::cmd(command);
    configure(&mut command);
    command
      .query_async(&mut self.connection)
      .await
      .map_err(|error| format!("Redis {command_name} failed: {error}"))
  }
}

impl RedisStore {
  pub fn from_client(client: redis::Client) -> Self {
    Self {
      client,
      config_error: None,
    }
  }

  pub fn from_client_with_error(
    client: redis::Client,
    error: impl Into<String>,
  ) -> Self {
    Self {
      client,
      config_error: Some(error.into()),
    }
  }

  pub async fn database(&self, database: u8) -> Result<RedisDatabase, String> {
    Ok(RedisDatabase {
      connection: self.connection(database).await?,
    })
  }

  async fn connection(
    &self,
    database: u8,
  ) -> Result<MultiplexedConnection, String> {
    if let Some(error) = &self.config_error {
      return Err(error.clone());
    }

    let mut connection =
      self
        .client
        .get_multiplexed_async_connection()
        .await
        .map_err(|error| format!("Redis connection failed: {error}"))?;

    redis::cmd("SELECT")
      .arg(database)
      .query_async::<()>(&mut connection)
      .await
      .map_err(|error| {
        format!("Redis DB {database} selection failed: {error}")
      })?;

    Ok(connection)
  }

  pub async fn store_challenge(
    &self,
    challenge_id: &str,
    nonce: [u8; 32],
  ) -> Result<(), String> {
    let mut connection = self.connection(1).await?;
    let key = format!("challenge:{challenge_id}");

    redis::cmd("SETEX")
      .arg(key)
      .arg(60)
      .arg(nonce.to_vec())
      .query_async::<()>(&mut connection)
      .await
      .map_err(|error| format!("Redis challenge SETEX failed: {error}"))
  }

  /// Atomically read and remove a challenge so it cannot be replayed by two
  /// concurrent verification requests.
  pub async fn take_challenge(
    &self,
    challenge_id: &str,
  ) -> Result<Option<[u8; 32]>, String> {
    let mut connection = self.connection(1).await?;
    let key = format!("challenge:{challenge_id}");
    let script = redis::Script::new(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
    );
    let nonce: Option<Vec<u8>> = script
      .key(key)
      .invoke_async(&mut connection)
      .await
      .map_err(|error| format!("Redis challenge consume failed: {error}"))?;

    match nonce {
      Some(bytes) if bytes.len() == 32 => {
        let mut value = [0u8; 32];
        value.copy_from_slice(&bytes);
        Ok(Some(value))
      }
      Some(_) => Err("Redis challenge contained an invalid nonce".to_string()),
      None => Ok(None),
    }
  }

  pub async fn set_json<T: Serialize>(
    &self,
    database: u8,
    key: &str,
    value: &T,
  ) -> Result<(), String> {
    let mut connection = self.connection(database).await?;
    let json = serde_json::to_string(value)
      .map_err(|error| format!("Redis JSON serialization failed: {error}"))?;

    redis::cmd("SET")
      .arg(key)
      .arg(json)
      .query_async::<()>(&mut connection)
      .await
      .map_err(|error| format!("Redis JSON SET failed: {error}"))
  }

  pub async fn get_json<T: DeserializeOwned>(
    &self,
    database: u8,
    key: &str,
  ) -> Result<Option<T>, String> {
    let mut connection = self.connection(database).await?;
    let json: Option<String> = redis::cmd("GET")
      .arg(key)
      .query_async(&mut connection)
      .await
      .map_err(|error| format!("Redis JSON GET failed: {error}"))?;

    json
      .map(|value| {
        serde_json::from_str(&value).map_err(|error| {
          format!("Redis JSON deserialization failed: {error}")
        })
      })
      .transpose()
  }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedisReadiness {
  Unknown,
  Ready,
  Unavailable,
}

impl RedisReadiness {
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Unknown => "unknown",
      Self::Ready => "ready",
      Self::Unavailable => "unavailable",
    }
  }

  pub fn from_u8(value: u8) -> Self {
    match value {
      1 => Self::Ready,
      2 => Self::Unavailable,
      _ => Self::Unknown,
    }
  }

  pub fn is_ready(self) -> bool {
    matches!(self, Self::Ready)
  }
}

impl RedisConfig {
  pub fn from_env() -> Self {
    Self {
      url: std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1/".to_string()),
    }
  }
}

/// Run a bounded connectivity check without making Redis a listener-startup
/// prerequisite. The caller owns the resulting readiness state and retry
/// policy.
pub async fn probe(client: &redis::Client) -> Result<(), String> {
  let mut connection = client
    .get_multiplexed_async_connection()
    .await
    .map_err(|error| format!("Redis connection failed: {error}"))?;

  let _: String = redis::cmd("PING")
    .query_async(&mut connection)
    .await
    .map_err(|error| format!("Redis health check failed: {error}"))?;

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::{RedisReadiness, RedisStore};

  #[test]
  fn redis_readiness_starts_unknown_until_a_probe_completes() {
    assert_eq!(RedisReadiness::Unknown.as_str(), "unknown");
    assert!(!RedisReadiness::Unknown.is_ready());
  }

  #[tokio::test]
  async fn challenge_storage_is_async_and_consumed_once() {
    let client = redis::Client::open("redis://127.0.0.1:6379")
      .expect("test Redis URL must be valid");
    let store = RedisStore::from_client(client);
    let challenge_id = format!("redis-service-test:{}", uuid::Uuid::new_v4());
    let nonce = crate::crypto::generate_nonce();

    store
      .store_challenge(&challenge_id, nonce)
      .await
      .expect("challenge should be stored");
    assert_eq!(
      store
        .take_challenge(&challenge_id)
        .await
        .expect("challenge lookup should succeed"),
      Some(nonce)
    );
    assert_eq!(
      store
        .take_challenge(&challenge_id)
        .await
        .expect("second challenge lookup should succeed"),
      None
    );
  }

  #[tokio::test]
  async fn degraded_store_does_not_use_a_fallback_endpoint() {
    let client = redis::Client::open("redis://127.0.0.1:6379")
      .expect("test Redis URL must be valid");
    let store = RedisStore::from_client_with_error(client, "invalid URL");

    let error = store
      .store_challenge("degraded-test", crate::crypto::generate_nonce())
      .await
      .expect_err("degraded Redis must reject writes");
    assert!(error.contains("invalid URL"));
  }

  #[tokio::test]
  async fn database_session_reuses_selected_database_for_queries() {
    let client = redis::Client::open("redis://127.0.0.1:6379")
      .expect("test Redis URL must be valid");
    let store = RedisStore::from_client(client);
    let key = format!("redis-service-test:query:{}", uuid::Uuid::new_v4());
    let mut database = store
      .database(2)
      .await
      .expect("database session should connect");

    let _: () = database
      .query("SET", |command| {
        command.arg(&key).arg("selected-db");
      })
      .await
      .expect("query should write the value");
    let value: String = database
      .query("GET", |command| {
        command.arg(&key);
      })
      .await
      .expect("query should read the value");

    assert_eq!(value, "selected-db");
  }

  #[tokio::test]
  async fn json_values_round_trip_through_the_requested_database() {
    let client = redis::Client::open("redis://127.0.0.1:6379")
      .expect("test Redis URL must be valid");
    let store = RedisStore::from_client(client);
    let key = format!("redis-service-test:json:{}", uuid::Uuid::new_v4());
    let expected = vec!["capture-a".to_string(), "capture-b".to_string()];

    store
      .set_json(1, &key, &expected)
      .await
      .expect("JSON value should be stored");
    let actual: Option<Vec<String>> = store
      .get_json(1, &key)
      .await
      .expect("JSON value should be loaded");

    assert_eq!(actual, Some(expected));
  }
}
