use serde_json;

#[tauri::command]
pub async fn check_activitywatch() -> Result<bool, String> {
    let client = reqwest::Client::new();
    match client.get("http://localhost:5600/api/0/info")
        .timeout(std::time::Duration::from_secs(2))
        .send().await {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn get_aw_buckets() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client.get("http://localhost:5600/api/0/buckets")
        .send().await.map_err(|e| e.to_string())?;
    resp.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_aw_events(bucket_id: String, start: String, end: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("http://localhost:5600/api/0/buckets/{}/events?start={}&end={}&limit=100", bucket_id, start, end);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    resp.json().await.map_err(|e| e.to_string())
}
