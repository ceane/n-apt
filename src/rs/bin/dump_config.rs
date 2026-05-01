use n_apt_backend::server::types::SignalsConfig;
use n_apt_backend::server::utils::{preprocess_frequency_tags, read_config_file};
use serde_json;

fn main() {
    let (content, _) = read_config_file("signals.yaml")
        .expect("Failed to read signals.yaml");
    
    let preprocessed = preprocess_frequency_tags(&content);
    
    let config: SignalsConfig = serde_yaml::from_str(&preprocessed)
        .expect("Failed to parse preprocessed YAML");
    
    println!("{}", serde_json::to_string_pretty(&config).unwrap());
}
