use serde::{Deserialize, Serialize};
use serde_yaml;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MockAptChannelConfig {
  pub label: String,
  #[serde(alias = "freq_range_mhz")]
  pub freq_range_hz: Vec<f64>,
  pub description: String,
}

fn main() {
  let yaml = r#"
label: "A"
freq_range_hz: [18000.0, 4470000.0]
description: "Test"
"#;
  let config: MockAptChannelConfig = serde_yaml::from_str(yaml).unwrap();
  println!("Config: {:?}", config);

  let yaml_old = r#"
label: "A"
freq_range_mhz: [0.018, 4.47]
description: "Test"
"#;
  let config_old: MockAptChannelConfig =
    serde_yaml::from_str(yaml_old).unwrap();
  println!("Config Old: {:?}", config_old);
}
