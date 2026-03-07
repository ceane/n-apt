use std::env;

// Network configuration helpers (single source of truth from WEBSOCKETS_URL)
fn websockets_url() -> String {
    env::var("WEBSOCKETS_URL").unwrap_or_else(|_| "http://localhost:8765".to_string())
}

pub fn ws_host() -> String {
    let url = websockets_url();
    url::Url::parse(&url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

pub fn ws_port() -> u16 {
    let url = websockets_url();
    url::Url::parse(&url)
        .ok()
        .and_then(|u| u.port())
        .unwrap_or(8765)
}

pub fn ws_url() -> String {
    let url = websockets_url();
    url::Url::parse(&url)
        .ok()
        .map(|u| format!("{}:{}", u.host_str().unwrap_or("127.0.0.1"), u.port_or_known_default().unwrap_or(8765)))
        .unwrap_or_else(|| "127.0.0.1:8765".to_string())
}
