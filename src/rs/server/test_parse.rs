use regex::Regex;

fn parse_frequency_hz(s: &str) -> f64 {
  let s = s.trim();
  let (num_str, unit) = if let Some(idx) = s.find(|c: char| c.is_alphabetic()) {
    (&s[..idx], &s[idx..])
  } else {
    (s, "")
  };

  let num: f64 = num_str.parse().unwrap_or(0.0);
  let unit_upper = unit.to_uppercase();

  match unit_upper.as_str() {
    "GHZ" => num * 1_000_000_000.0,
    "MHZ" => num * 1_000_000.0,
    "KHZ" => num * 1000.0,
    "HZ" => num,
    _ => num,
  }
}

fn preprocess_frequency_tags(content: &str) -> String {
  let re_single =
    Regex::new(r"!frequency\s+([\d.]+)\s*([kKmMgG]?Hz)\b").unwrap();
  let content = re_single
    .replace_all(content, |caps: &regex::Captures| {
      let value: f64 = caps[1].parse().unwrap_or(0.0);
      let unit = caps[2].to_uppercase();
      let multiplier = match unit.as_str() {
        "GHZ" => 1e9,
        "MHZ" => 1e6,
        "KHZ" => 1e3,
        "HZ" => 1.0,
        _ => 1.0,
      };
      (value * multiplier).to_string()
    })
    .to_string();

  let re_range = Regex::new(r"!frequency_range\s+(\d+\.?\d*[kKmMgG]?Hz)\s*\.\.\s*(\d+\.?\d*[kKmMgG]?Hz)").unwrap();
  let content = re_range
    .replace_all(&content, |caps: &regex::Captures| {
      let start = parse_frequency_hz(&caps[1]);
      let end = parse_frequency_hz(&caps[2]);
      format!("[{}, {}]", start, end)
    })
    .to_string();
    
  content
}

fn main() {
    let input = "!frequency_range 18kHz..4.39MHz";
    println!("{}", preprocess_frequency_tags(input));
    
    let input2 = r"mock_apt:
    channels:
      a:
        label: ""A""
        freq_range_hz: !frequency_range 18kHz..4.47MHz
";
    println!("{}", preprocess_frequency_tags(input2));
}
