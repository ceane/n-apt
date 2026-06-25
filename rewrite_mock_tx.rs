use std::fs;
fn main() {
    let content = fs::read_to_string("src/rs/server/websocket_server/mock_tx.rs").unwrap();
    // I will use replace_file_content instead of doing it with a script, 
    // it's safer.
}
