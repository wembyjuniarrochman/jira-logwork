mod jira;
mod activitywatch;

use jira::*;
use reqwest::Client;
use serde_json::json;
use futures::stream::StreamExt;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent, WebviewUrl, WebviewWindowBuilder,
};
use chrono::{Local, Timelike};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use std::sync::OnceLock;
use std::time::Duration;

/// Shared HTTP client.
///
/// `reqwest::Client` owns its connection pool, so building a new one per
/// command threw the pool away and forced a fresh TCP + TLS handshake on
/// every Jira call. One process-wide client keeps connections warm across
/// commands — worth a few hundred ms on each request, and `get_my_worklogs`
/// alone issues one request per issue in the range.
///
/// Cloning is cheap: the client is reference-counted internally and clones
/// share the same pool.
/// Cache id custom field "Work Reference" per base URL.
///
/// `None` sebagai nilai berarti "sudah dicari, instance ini memang tidak
/// punya field tersebut" — dibedakan dari "belum pernah dicari", supaya
/// instance tanpa field itu tidak mengulang lookup di setiap reconcile.
fn work_ref_cache() -> &'static Mutex<std::collections::HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<std::collections::HashMap<String, Option<String>>>> =
        OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .pool_idle_timeout(Duration::from_secs(90))
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| Client::new())
    })
}

/// Persist before installation: Windows may exit before JavaScript resumes.
#[tauri::command]
fn prepare_update_restart(app: tauri::AppHandle, version: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("update-restart-version"), version).map_err(|e| e.to_string())
}

fn take_update_restart(app: &tauri::AppHandle) -> bool {
    let Ok(dir) = app.path().app_data_dir() else { return false };
    let marker = dir.join("update-restart-version");
    let Ok(version) = std::fs::read_to_string(&marker) else { return false };
    if version.trim() != app.package_info().version.to_string() { return false; }
    // Leave a one-shot success receipt for the webview. This is written only
    // after the restarted binary reports the requested version, so the UI
    // does not claim success merely because the installer returned `Ok`.
    let _ = std::fs::write(
        dir.join("update-installed-version"),
        app.package_info().version.to_string(),
    );
    let _ = std::fs::remove_file(marker);
    true
}

#[tauri::command]
fn take_update_success(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let marker = dir.join("update-installed-version");
    let version = match std::fs::read_to_string(&marker) {
        Ok(value) => value.trim().to_string(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.to_string()),
    };
    std::fs::remove_file(marker).map_err(|e| e.to_string())?;
    Ok(Some(version))
}

// --- Timer State (shared between tray menu and windows) ---

/// Extract (x, y, width, height) from a Tauri Rect regardless of Physical/Logical variant.
fn extract_rect(rect: &tauri::Rect) -> (f64, f64, f64, f64) {
    let (x, y) = match &rect.position {
        tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
        tauri::Position::Logical(p) => (p.x, p.y),
    };
    let (w, h) = match &rect.size {
        tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
        tauri::Size::Logical(s) => (s.width, s.height),
    };
    (x, y, w, h)
}

/// Last known tray icon position, updated on every tray event.
#[derive(Debug, Clone, Default)]
pub struct TrayPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrayTimerState {
    pub issue_key: Option<String>,
    pub summary: Option<String>,
    pub start_time: Option<u64>, // epoch millis when started
    pub accumulated_seconds: f64,
    pub running: bool,
}

impl Default for TrayTimerState {
    fn default() -> Self {
        Self {
            issue_key: None,
            summary: None,
            start_time: None,
            accumulated_seconds: 0.0,
            running: false,
        }
    }
}

/// Bring the main window back to the foreground (from the tray / minimized).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Open or focus the Quick Log mini window near the tray icon.
fn open_quicklog_window(app: &tauri::AppHandle) {
    open_quicklog_window_at(app, None);
}

/// Open or focus the Quick Log mini window, optionally positioned near coordinates.
fn open_quicklog_window_at(app: &tauri::AppHandle, tray_position: Option<(f64, f64)>) {
    if let Some(w) = app.get_webview_window("quicklog") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }

    let win_width = 380.0;
    let win_height = 520.0;

    let mut builder = WebviewWindowBuilder::new(app, "quicklog", WebviewUrl::App("quicklog.html".into()))
        .title("Quick Log")
        .inner_size(win_width, win_height)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .visible(true)
        .decorations(true);

    if let Some((x, y)) = tray_position {
        // Position window so its top-center aligns with the tray icon center,
        // just below the menu bar (y is already the bottom of the tray icon area)
        let win_x = (x - win_width / 2.0).max(0.0);
        let win_y = y;
        builder = builder.position(win_x, win_y);
    } else {
        builder = builder.center();
    }

    let _ = builder.build();
}

// --- Tauri commands for timer ---

#[tauri::command]
fn get_timer_state(state: tauri::State<'_, Mutex<TrayTimerState>>) -> TrayTimerState {
    state.lock().unwrap().clone()
}

#[tauri::command]
fn start_timer(state: tauri::State<'_, Mutex<TrayTimerState>>, issue_key: String, summary: String) -> TrayTimerState {
    let mut s = state.lock().unwrap();
    s.issue_key = Some(issue_key);
    s.summary = Some(summary);
    s.start_time = Some(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64);
    s.running = true;
    s.clone()
}

#[tauri::command]
fn stop_timer(state: tauri::State<'_, Mutex<TrayTimerState>>) -> TrayTimerState {
    let mut s = state.lock().unwrap();
    if s.running {
        if let Some(start) = s.start_time {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
            let elapsed = (now - start) as f64 / 1000.0;
            s.accumulated_seconds += elapsed;
        }
        s.start_time = None;
        s.running = false;
    }
    s.clone()
}

#[tauri::command]
fn reset_timer(state: tauri::State<'_, Mutex<TrayTimerState>>) -> TrayTimerState {
    let mut s = state.lock().unwrap();
    *s = TrayTimerState::default();
    s.clone()
}

#[tauri::command]
fn open_quicklog(app: tauri::AppHandle) {
    open_quicklog_window(&app);
}

#[tauri::command]
async fn test_connection(base_url: String, email: String, api_token: String, is_cloud: bool) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let resp = client.get(&format!("{}/myself", config.api_base()))
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    let user: JiraUser = resp.json().await.map_err(|e| e.to_string())?;
    Ok(user.display_name)
}

#[tauri::command]
async fn get_projects(base_url: String, email: String, api_token: String, is_cloud: bool) -> Result<Vec<JiraProject>, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let resp = client.get(&format!("{}/project", config.api_base()))
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
    resp.json().await.map_err(|e| e.to_string())
}

/// True bila `s` berbentuk issue key utuh, mis. "UMS-405". Dipakai untuk
/// memutuskan apakah pencarian perlu ikut mencocokkan `key`.
fn is_issue_key(s: &str) -> bool {
    let mut parts = s.splitn(2, '-');
    let (Some(prefix), Some(num)) = (parts.next(), parts.next()) else {
        return false;
    };
    !prefix.is_empty()
        && prefix.chars().all(|c| c.is_ascii_alphanumeric())
        && !num.is_empty()
        && num.chars().all(|c| c.is_ascii_digit())
}

/// Escape characters interpreted as operators by Jira's underlying text
/// search parser. The value is later placed in a quoted JQL string, so this
/// is deliberately separate from `escape_jql_string` below: the two parsers
/// have different escape rules.
///
/// This keeps searches for issue summaries containing punctuation such as
/// `;`, `-`, `"`, `'`, `/`, or parentheses valid and literal.
fn escape_jira_text_search(s: &str) -> String {
    let mut escaped = String::with_capacity(s.len());
    for ch in s.chars() {
        if matches!(
            ch,
            '+' | '-'
                | '&'
                | '|'
                | '!'
                | '('
                | ')'
                | '{'
                | '}'
                | '['
                | ']'
                | '^'
                | '"'
                | '~'
                | '*'
                | '?'
                | ':'
                | '\\'
                | '/'
        ) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

/// Escape a value that will be written inside a double-quoted JQL literal.
fn escape_jql_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Jira does not index punctuation such as `;`, `-`, or quotes for text
/// searches. Keep track of queries that need a literal summary comparison
/// after Jira has returned candidate issues.
fn needs_literal_summary_filter(query: &str) -> bool {
    let has_special_character = query
        .chars()
        .any(|ch| !ch.is_alphanumeric() && !ch.is_whitespace());
    // Jira's text index is optimized for words. Numeric references embedded
    // in summaries (for example `[IRQ-1460]`) are not consistently returned
    // by `summary ~ "1460*"`, so resolve number-only searches literally too.
    let number_only = !query.is_empty() && query.chars().all(|ch| ch.is_ascii_digit());
    has_special_character || number_only
}

/// Retain only issues whose summary contains the user's original query.
/// Jira's text index discards punctuation, while this comparison preserves it.
fn filter_issues_by_literal_summary(response: &str, query: &str) -> Result<String, String> {
    let needle = query.to_lowercase();
    let mut payload: serde_json::Value = serde_json::from_str(response).map_err(|e| e.to_string())?;
    if let Some(issues) = payload.get_mut("issues").and_then(serde_json::Value::as_array_mut) {
        issues.retain(|issue| {
            issue["fields"]["summary"]
                .as_str()
                .is_some_and(|summary| summary.to_lowercase().contains(&needle))
        });
    }
    serde_json::to_string(&payload).map_err(|e| e.to_string())
}

/// Fetch one page of Jira issue search results with a consistent response
/// shape. Literal punctuation searches use the same endpoint as normal JQL,
/// but need a larger candidate set because punctuation is absent from Jira's
/// text index.
async fn fetch_issue_search_response(
    client: &Client,
    config: &JiraConfig,
    jql: &str,
    max_results: u16,
) -> Result<String, String> {
    let url = format!(
        "{}/rest/api/3/search/jql?jql={}&maxResults={}&fields=summary,issuetype,subtasks",
        config.base_url.trim_end_matches('/'),
        urlencoding::encode(jql),
        max_results
    );
    let resp = client
        .get(&url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!(
            "HTTP {}: {}",
            resp.status(),
            resp.text().await.unwrap_or_default()
        ));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// Add exact-key results ahead of literal-summary results, without returning
/// duplicate issues. This matters for a query such as `IRQ-1460`: it may be
/// a real Jira key, or a code embedded in another issue's summary.
fn merge_issue_search_responses(primary: &str, secondary: &str) -> Result<String, String> {
    let mut primary_payload: serde_json::Value =
        serde_json::from_str(primary).map_err(|e| e.to_string())?;
    let secondary_payload: serde_json::Value =
        serde_json::from_str(secondary).map_err(|e| e.to_string())?;

    let Some(primary_issues) = primary_payload
        .get_mut("issues")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return serde_json::to_string(&primary_payload).map_err(|e| e.to_string());
    };

    let mut seen: std::collections::HashSet<String> = primary_issues
        .iter()
        .filter_map(|issue| issue["key"].as_str().map(str::to_owned))
        .collect();
    if let Some(secondary_issues) = secondary_payload
        .get("issues")
        .and_then(serde_json::Value::as_array)
    {
        for issue in secondary_issues {
            let Some(key) = issue["key"].as_str() else {
                continue;
            };
            if seen.insert(key.to_owned()) {
                primary_issues.push(issue.clone());
            }
        }
    }
    serde_json::to_string(&primary_payload).map_err(|e| e.to_string())
}

#[tauri::command]
async fn search_issues(base_url: String, email: String, api_token: String, is_cloud: bool, project_key: String, query: String) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let query = query.trim();

    // Klausa project dihilangkan saat scope-nya "semua project". Sebelumnya
    // `project = ` tetap ditulis dengan nilai kosong, menghasilkan JQL tidak
    // sah — pemanggilnya memang menangkap error itu lalu memindai project
    // satu per satu, jadi pencarian global selalu menempuh jalur mahal.
    let project_clause = if project_key.trim().is_empty() {
        String::new()
    } else {
        format!("project = {} AND ", project_key)
    };

    let requires_literal_filter = needs_literal_summary_filter(query);

    let jql = if query.is_empty() {
        match project_key.trim().is_empty() {
            true => "ORDER BY updated DESC".to_string(),
            false => format!("project = {} ORDER BY updated DESC", project_key),
        }
    } else if requires_literal_filter {
        // Jira strips punctuation from its text index. Fetch a broader recent
        // set and apply an exact summary comparison below; this supports
        // `[IRQ-1460]`, `IRQ-1460`, and `;` alike.
        format!("{}summary IS NOT EMPTY ORDER BY updated DESC", project_clause)
    } else {
        // Kotak ini menjanjikan "issue key atau summary", tapi `summary ~`
        // tidak pernah mencocokkan key. Saat inputnya berbentuk key utuh
        // (mis. "UMS-405"), cocokkan key-nya juga.
        let key_clause = if is_issue_key(query) {
            format!(" OR key = \"{}\"", query.to_uppercase())
        } else {
            String::new()
        };
        // `summary ~` diteruskan Jira ke parser pencarian teksnya sendiri.
        // Escape dulu operator parser itu (mis. `-`, `"`, dan `/`), lalu
        // escape lagi untuk string JQL. Sufiks wildcard sengaja ditambahkan
        // setelah escaping agar pencarian awalan seperti "Daily" tetap ada.
        let text_query = escape_jql_string(&format!("{}*", escape_jira_text_search(query)));
        // Sufiks `*` mengubah pencocokan kata-utuh jadi per-awalan-kata.
        // Tanpa ini, `summary ~ "p"` tidak pernah cocok dengan "Payment",
        // sehingga mengetik satu-dua huruf selalu menghasilkan nol hasil.
        format!(
            "{}(summary ~ \"{}\"{}) ORDER BY updated DESC",
            project_clause, text_query, key_clause
        )
    };
    let max_results = if requires_literal_filter { 1000 } else { 50 };
    let text = fetch_issue_search_response(&client, &config, &jql, max_results).await?;
    if requires_literal_filter {
        let literal_matches = filter_issues_by_literal_summary(&text, query)?;
        if is_issue_key(query) {
            let exact_key_jql = format!(
                "{}key = \"{}\" ORDER BY updated DESC",
                project_clause,
                query.to_uppercase()
            );
            let exact_key_matches =
                fetch_issue_search_response(&client, &config, &exact_key_jql, 1).await?;
            merge_issue_search_responses(&exact_key_matches, &literal_matches)
        } else {
            Ok(literal_matches)
        }
    } else {
        Ok(text)
    }
}

#[tauri::command]
async fn add_worklog(base_url: String, email: String, api_token: String, is_cloud: bool, issue_key: String, time_spent_seconds: u64, started: String, comment: String) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let url = format!("{}/issue/{}/worklog", config.api_base(), issue_key);
    let body = json!({
        "timeSpentSeconds": time_spent_seconds,
        "started": started,
        "comment": comment
    });
    let resp = client.post(&url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    Ok("Worklog added".to_string())
}

/// Update an existing worklog's date / duration / comment. Used by the
/// calendar drag-and-drop to move a worklog entry between dates without
/// going through delete+create (which would lose the worklog id and any
/// linked metadata).
#[tauri::command]
async fn update_worklog(
    base_url: String,
    email: String,
    api_token: String,
    is_cloud: bool,
    issue_key: String,
    worklog_id: String,
    time_spent_seconds: u64,
    started: String,
    comment: Option<String>,
) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let url = format!("{}/issue/{}/worklog/{}", config.api_base(), issue_key, worklog_id);
    let mut body = serde_json::Map::new();
    body.insert("timeSpentSeconds".to_string(), json!(time_spent_seconds));
    body.insert("started".to_string(), json!(started));
    if let Some(c) = comment {
        body.insert("comment".to_string(), json!(c));
    }
    let resp = client.put(&url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .json(&serde_json::Value::Object(body))
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    Ok("Worklog updated".to_string())
}

#[tauri::command]
async fn get_worklogs(base_url: String, email: String, api_token: String, is_cloud: bool, issue_key: String) -> Result<Vec<Worklog>, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    // Include enough history for offline retry deduplication. Without an
    // explicit maxResults Jira can return only the first page and hide the
    // newly accepted worklog we are checking for.
    let resp = client.get(&format!(
        "{}/issue/{}/worklog?maxResults=5000",
        config.api_base(),
        issue_key,
    ))
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
    let result: WorklogResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(result.worklogs)
}

/// Fetch direct children of an issue (Epic → Tasks/Stories, Task/Story →
/// Sub-tasks) via JQL `parent = "KEY"`. The unified `parent` field works
/// for both hierarchy levels in modern Jira Cloud (≥ 2022) and Server
/// 8.x+ instances. Capped at 50 results to match the picker UI; callers
/// that hit the cap can fall back to the regular search input to drill
/// further.
#[tauri::command]
async fn get_issue_children(base_url: String, email: String, api_token: String, is_cloud: bool, parent_key: String) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let jql = format!("parent = \"{}\" ORDER BY created ASC", parent_key);
    let url = format!("{}/rest/api/3/search/jql?jql={}&maxResults=50&fields=summary,issuetype,subtasks",
        config.base_url.trim_end_matches('/'), urlencoding::encode(&jql));
    let resp = client.get(&url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(text)
}

/// Given a list of parent issue keys, return only the keys that actually
/// have at least one child issue (via JQL `parent in (...)`). Used by
/// UniversalSearch to decide upfront whether an Epic row gets a chevron
/// in the tree picker — Tasks/Stories use the `subtasks` field directly,
/// but Epics can't be detected that way (their children are linked by
/// `parent`, not the legacy `subtasks` field).
#[tauri::command]
async fn get_parents_with_children(base_url: String, email: String, api_token: String, is_cloud: bool, parent_keys: Vec<String>) -> Result<Vec<String>, String> {
    if parent_keys.is_empty() {
        return Ok(Vec::new());
    }
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    // Build a quoted, comma-separated key list. Keys that contain a quote
    // would be rejected by Jira anyway, so a defensive filter keeps the
    // JQL well-formed.
    let quoted: Vec<String> = parent_keys
        .iter()
        .filter(|k| !k.contains('"') && !k.is_empty())
        .map(|k| format!("\"{}\"", k))
        .collect();
    if quoted.is_empty() {
        return Ok(Vec::new());
    }
    let jql = format!("parent in ({})", quoted.join(","));
    // We only need the parent link for each match — `fields=parent` keeps
    // payload tiny even when the result set is large.
    let url = format!("{}/rest/api/3/search/jql?jql={}&maxResults=500&fields=parent",
        config.base_url.trim_end_matches('/'), urlencoding::encode(&jql));
    let resp = client.get(&url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let issues = data["issues"].as_array().cloned().unwrap_or_default();
    let mut found: std::collections::HashSet<String> = std::collections::HashSet::new();
    for issue in issues {
        if let Some(parent_key) = issue["fields"]["parent"]["key"].as_str() {
            found.insert(parent_key.to_string());
        }
    }
    Ok(found.into_iter().collect())
}
/// JQL: `project = "KEY" AND issuetype = Epic ORDER BY created DESC`.
/// Tasks and sub-tasks are loaded later via `get_issue_children` when the
/// user expands an Epic / Task in the tree.
#[tauri::command]
async fn get_project_epics(base_url: String, email: String, api_token: String, is_cloud: bool, project_key: String) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let jql = format!(
        "project = \"{}\" AND issuetype = Epic ORDER BY created DESC",
        project_key
    );
    let url = format!("{}/rest/api/3/search/jql?jql={}&maxResults=100&fields=summary,issuetype,subtasks",
        config.base_url.trim_end_matches('/'), urlencoding::encode(&jql));
    let resp = client.get(&url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(text)
}


/// Create a new Jira issue under `parent_key`. Used for "Add Task" inside an
/// Epic and "Add Sub-task" inside a Task/Story/Bug. `custom_fields` is a free
/// map of `customfield_XXXXX` → JSON value, so the frontend can attach
/// instance-specific fields (e.g. "Work Reference") without the Rust side
/// hard-coding their IDs.
#[tauri::command]
async fn create_issue(
    base_url: String,
    email: String,
    api_token: String,
    is_cloud: bool,
    project_key: String,
    issuetype_name: String,
    summary: String,
    parent_key: Option<String>,
    assignee_account_id: Option<String>,
    custom_fields: Option<serde_json::Map<String, serde_json::Value>>,
) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let url = format!("{}/rest/api/3/issue", config.base_url.trim_end_matches('/'));

    let mut fields = serde_json::Map::new();
    fields.insert("project".to_string(), json!({ "key": project_key }));
    fields.insert("issuetype".to_string(), json!({ "name": issuetype_name }));
    fields.insert("summary".to_string(), json!(summary));
    if let Some(parent) = parent_key {
        if !parent.is_empty() {
            fields.insert("parent".to_string(), json!({ "key": parent }));
        }
    }
    if let Some(acc_id) = assignee_account_id {
        if !acc_id.is_empty() {
            // Cloud uses accountId; Server/DC uses name. We default to
            // accountId since the codebase elsewhere assumes Cloud-style
            // identifiers — adjust here if Server support is needed.
            if config.is_cloud {
                fields.insert("assignee".to_string(), json!({ "accountId": acc_id }));
            } else {
                fields.insert("assignee".to_string(), json!({ "name": acc_id }));
            }
        }
    }
    if let Some(cf) = custom_fields {
        for (k, v) in cf {
            fields.insert(k, v);
        }
    }
    let body = json!({ "fields": fields });

    let resp = client.post(&url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(text)
}

/// Fetch users assignable to a given project, used to populate the assignee
/// dropdown in the Add-Task / Add-Subtask inline form. Capped at 50 to match
/// other pickers in the app.
#[tauri::command]
async fn get_assignable_users(
    base_url: String,
    email: String,
    api_token: String,
    is_cloud: bool,
    project_key: String,
) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let url = format!(
        "{}/rest/api/3/user/assignable/search?project={}&maxResults=50",
        config.base_url.trim_end_matches('/'),
        urlencoding::encode(&project_key),
    );
    let resp = client.get(&url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// Fetch full createmeta (issuetypes + fields + allowed values) for a project.
/// The frontend uses the response to: (1) discover the subtask issuetype name
/// without hard-coding "Sub-task" vs "Subtask", (2) populate the issuetype
/// dropdown, and (3) discover custom fields like "Work Reference" with their
/// `allowedValues`.
#[tauri::command]
async fn get_create_meta(
    base_url: String,
    email: String,
    api_token: String,
    is_cloud: bool,
    project_key: String,
) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let url = format!(
        "{}/rest/api/3/issue/createmeta?projectKeys={}&expand=projects.issuetypes.fields",
        config.base_url.trim_end_matches('/'),
        urlencoding::encode(&project_key),
    );
    let resp = client.get(&url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_my_worklogs(base_url: String, email: String, api_token: String, is_cloud: bool, start_date: String, end_date: String) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();

    // Step 0: Resolve the authenticated user's identity from /myself.
    // We collect every identifier Jira may return (accountId on Cloud,
    // name/key on Server/DC, emailAddress where exposed) so we can match
    // a worklog's author robustly regardless of deployment or privacy
    // settings.
    let myself_url = format!("{}/myself", config.api_base());
    let myself_resp = client.get(&myself_url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !myself_resp.status().is_success() {
        return Err(format!(
            "HTTP {}: {}",
            myself_resp.status(),
            myself_resp.text().await.unwrap_or_default()
        ));
    }
    let me: serde_json::Value = myself_resp.json().await.map_err(|e| e.to_string())?;
    let my_account_id = me["accountId"].as_str().unwrap_or("").to_string();
    let my_name = me["name"].as_str().unwrap_or("").to_string();
    let my_key = me["key"].as_str().unwrap_or("").to_string();
    let my_email_lc = me["emailAddress"]
        .as_str()
        .unwrap_or(&config.email)
        .trim()
        .to_lowercase();
    let cred_email_lc = config.email.trim().to_lowercase();

    // Pure: returns true iff `worklog.author` belongs to the authenticated
    // user. We compare every available identifier; any single match wins.
    let is_mine = |worklog: &serde_json::Value| -> bool {
        let author = &worklog["author"];
        if !my_account_id.is_empty() {
            if author["accountId"].as_str() == Some(&my_account_id) {
                return true;
            }
        }
        if !my_key.is_empty() {
            if author["key"].as_str() == Some(&my_key) {
                return true;
            }
        }
        if !my_name.is_empty() {
            if author["name"].as_str() == Some(&my_name) {
                return true;
            }
        }
        let author_email_lc = author["emailAddress"]
            .as_str()
            .unwrap_or("")
            .trim()
            .to_lowercase();
        if !author_email_lc.is_empty() {
            if author_email_lc == my_email_lc || author_email_lc == cred_email_lc {
                return true;
            }
        }
        false
    };

    // Step 0b: Resolve the "Work Reference" custom field id.
    //
    // It is a per-instance custom field, so its `customfield_NNNNN` key is
    // not knowable upfront — we look it up by display name. The lookup is
    // best-effort: if the instance has no such field, or the call fails, we
    // simply omit the value rather than failing the whole worklog fetch.
    //
    // Cached per base URL: custom field ids are stable for the lifetime of a
    // Jira instance, and this command runs on every reconcile — without the
    // cache it would add a round trip to each one.
    let cached_field = work_ref_cache()
        .lock()
        .ok()
        .and_then(|m| m.get(&config.base_url).cloned());

    let work_ref_field: Option<String> = if let Some(hit) = cached_field {
        hit
    } else {
        let looked_up = async {
        let url = format!("{}/field", config.api_base());
        let r = client
            .get(&url)
            .header("Authorization", config.auth_header())
            .header("Content-Type", "application/json")
            .send()
            .await
            .ok()?;
        if !r.status().is_success() {
            return None;
        }
        let fields: Vec<serde_json::Value> = r.json().await.ok()?;
        fields.into_iter().find_map(|f| {
            let name = f["name"].as_str()?.trim().to_lowercase();
            if name == "work reference" {
                Some(f["id"].as_str()?.to_string())
            } else {
                None
            }
        })
        }
        .await;
        if let Ok(mut m) = work_ref_cache().lock() {
            m.insert(config.base_url.clone(), looked_up.clone());
        }
        looked_up
    };

    // Step 1: Find issues with my worklogs in the requested range.
    // worklogAuthor = currentUser() restricts the search to issues where I
    // have logged at least one worklog; the per-worklog filter below then
    // drops any non-mine entries on those issues.
    let jql = format!("worklogDate >= '{}' AND worklogDate <= '{}' AND worklogAuthor = currentUser() ORDER BY updated DESC", start_date, end_date);
    let fields_param = match &work_ref_field {
        Some(k) => format!("summary,issuetype,{}", k),
        None => "summary,issuetype".to_string(),
    };
    let search_url = format!("{}/rest/api/3/search/jql?jql={}&maxResults=1000&fields={}",
        config.base_url.trim_end_matches('/'), urlencoding::encode(&jql), fields_param);
    let resp = client.get(&search_url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    let search_result: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let issues = search_result["issues"].as_array().cloned().unwrap_or_default();

    // Step 2: For each issue, fetch its worklogs and keep only mine.
    // Run in parallel (concurrency limit 8) so the response time is bounded
    // by the slowest worklog request rather than the sum of all of them.
    // The previous sequential loop took ~N * RTT; the parallel version
    // typically completes in ~ceil(N/8) * RTT.
    const CONCURRENCY: usize = 8;
    let api_base = config.api_base();
    let auth = config.auth_header();

    /// Human-readable label of a Work Reference value. The field may come
    /// back as an option object (`value` / `name`), a plain string, or an
    /// array when it is multi-select; anything else yields None.
    fn work_ref_label(v: &serde_json::Value) -> Option<String> {
        match v {
            serde_json::Value::Null => None,
            serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
            serde_json::Value::Array(items) => {
                let joined: Vec<String> = items.iter().filter_map(work_ref_label).collect();
                if joined.is_empty() { None } else { Some(joined.join(", ")) }
            }
            serde_json::Value::Object(_) => v["value"]
                .as_str()
                .or_else(|| v["name"].as_str())
                .map(|s| s.to_string()),
            _ => None,
        }
    }

    // Build owned per-issue futures so the iterator is `Send`.
    let issue_inputs: Vec<(String, String, String)> = issues
        .iter()
        .map(|issue| {
            let work_ref = work_ref_field
                .as_ref()
                .and_then(|k| work_ref_label(&issue["fields"][k]))
                .unwrap_or_default();
            (
                issue["key"].as_str().unwrap_or("").to_string(),
                issue["fields"]["summary"].as_str().unwrap_or("").to_string(),
                work_ref,
            )
        })
        .collect();

    let fetched: Vec<(String, String, String, Vec<serde_json::Value>)> =
        futures::stream::iter(issue_inputs.into_iter().map(|(key, summary, work_ref)| {
            let client = client.clone();
            let api_base = api_base.clone();
            let auth = auth.clone();
            async move {
                if key.is_empty() {
                    return (key, summary, work_ref, Vec::new());
                }
                let wl_url = format!("{}/issue/{}/worklog?maxResults=1000", api_base, key);
                let wl_resp = client
                    .get(&wl_url)
                    .header("Authorization", auth)
                    .header("Content-Type", "application/json")
                    .send()
                    .await;
                let worklogs = match wl_resp {
                    Ok(r) if r.status().is_success() => {
                        let wl_data: serde_json::Value =
                            r.json().await.unwrap_or(json!({"worklogs":[]}));
                        wl_data["worklogs"].as_array().cloned().unwrap_or_default()
                    }
                    _ => Vec::new(),
                };
                (key, summary, work_ref, worklogs)
            }
        }))
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await;

    let mut result_issues: Vec<serde_json::Value> = Vec::new();
    for (key, summary, work_ref, all) in fetched {
        let mine: Vec<serde_json::Value> =
            all.into_iter().filter(|w| is_mine(w)).collect();
        if mine.is_empty() {
            continue;
        }
        result_issues.push(json!({
            "key": key,
            "fields": {
                "summary": summary,
                "workReference": work_ref,
                "worklog": { "worklogs": mine }
            }
        }));
    }

    let result = json!({ "issues": result_issues });
    Ok(result.to_string())
}

#[tauri::command]
async fn delete_worklog(
    base_url: String,
    email: String,
    api_token: String,
    is_cloud: bool,
    issue_key: String,
    worklog_id: String,
) -> Result<String, String> {
    let config = JiraConfig { base_url, email, api_token, is_cloud };
    let client = http_client().clone();
    let url = format!("{}/issue/{}/worklog/{}", config.api_base(), issue_key, worklog_id);
    let resp = client.delete(&url)
        .header("Authorization", config.auth_header())
        .header("Content-Type", "application/json")
        .send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()));
    }
    Ok("Worklog deleted".to_string())
}

#[tauri::command]
fn update_tray_tooltip(app: tauri::AppHandle, status: String) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_tooltip(Some(&status)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Autostart at login (Level 2). The `--minimized` arg lets the setup
        // hook start the app hidden in the tray when launched automatically.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Mutex::new(TrayTimerState::default()))
        .manage(Mutex::new(TrayPosition::default()))
        .setup(|app| {
            // System tray so the app can keep running (and auto-log worklogs)
            // in the background while the main window is closed.
            let quicklog_i =
                MenuItem::with_id(app, "quicklog", "⚡ Quick Log", true, None::<&str>)?;
            let timer_i =
                MenuItem::with_id(app, "timer", "⏱ Start Timer", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let show_i =
                MenuItem::with_id(app, "show", "Buka JIRA Logwork", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quicklog_i, &timer_i, &sep1, &show_i, &quit_i])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("JIRA Logwork")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quicklog" => {
                        let pos = app.state::<Mutex<TrayPosition>>();
                        let p = pos.lock().unwrap();
                        let position = if p.x > 0.0 { Some((p.x, p.y)) } else { None };
                        drop(p);
                        open_quicklog_window_at(app, position);
                    }
                    "timer" => {
                        // Toggle timer: if running → stop & open quicklog, if stopped → open quicklog
                        let state = app.state::<Mutex<TrayTimerState>>();
                        let running = {
                            let s = state.lock().unwrap();
                            s.running
                        };
                        if running {
                            let mut s = state.lock().unwrap();
                            if let Some(start) = s.start_time {
                                let now = std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
                                let elapsed = (now - start) as f64 / 1000.0;
                                s.accumulated_seconds += elapsed;
                            }
                            s.start_time = None;
                            s.running = false;
                            drop(s);
                        }
                        let pos = app.state::<Mutex<TrayPosition>>();
                        let p = pos.lock().unwrap();
                        let position = if p.x > 0.0 { Some((p.x, p.y)) } else { None };
                        drop(p);
                        open_quicklog_window_at(app, position);
                    }
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            rect,
                            ..
                        } => {
                            let (rx, ry, rw, rh) = extract_rect(&rect);
                            let icon_x = rx + rw / 2.0;
                            let icon_y = ry + rh;
                            // Store for menu events
                            {
                                let pos = tray.app_handle().state::<Mutex<TrayPosition>>();
                                let mut p = pos.lock().unwrap();
                                p.x = icon_x;
                                p.y = icon_y;
                            }
                            // Open Quick Log near tray icon
                            open_quicklog_window_at(tray.app_handle(), Some((icon_x, icon_y)));
                        }
                        TrayIconEvent::Click {
                            button: MouseButton::Right,
                            rect,
                            ..
                        } => {
                            let (rx, ry, rw, rh) = extract_rect(&rect);
                            let pos = tray.app_handle().state::<Mutex<TrayPosition>>();
                            let mut p = pos.lock().unwrap();
                            p.x = rx + rw / 2.0;
                            p.y = ry + rh;
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // --- Global Shortcut: CmdOrCtrl+Shift+L to open Quick Log ---
            // Non-fatal: on macOS this requires Accessibility permission which
            // may not be granted yet. The app should still work without it.
            let shortcut_handle = app.handle().clone();
            if let Err(e) = app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+L", move |_app, _shortcut, _event| {
                open_quicklog_window(&shortcut_handle);
            }) {
                eprintln!("[warn] Failed to register global shortcut: {e}. App continues without it.");
            }

            // --- Background task: reminder checks & long-running timer ---
            let bg_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Initial delay: wait 60s before first check to let app finish startup
                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;

                let mut last_reminder_hour: Option<u32> = None;
                loop {
                    let now = Local::now();
                    let hour = now.hour();

                    // Emit reminder-check at 11:00 and 16:00 (within the 30-min window)
                    if (hour == 11 || hour == 16) && last_reminder_hour != Some(hour) {
                        let _ = bg_handle.emit("reminder-check", json!({
                            "hour": hour
                        }));
                        last_reminder_hour = Some(hour);
                    } else if hour != 11 && hour != 16 {
                        last_reminder_hour = None;
                    }

                    // Check if timer has been running > 4 hours
                    let state = bg_handle.state::<Mutex<TrayTimerState>>();
                    let should_warn = {
                        let s = state.lock().unwrap();
                        if s.running {
                            if let Some(start) = s.start_time {
                                let now_ms = std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_millis() as u64;
                                let elapsed_hours = (now_ms - start) as f64 / 1000.0 / 3600.0;
                                elapsed_hours > 4.0
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    };
                    if should_warn {
                        let _ = bg_handle.emit("timer-long-running", json!({
                            "message": "Timer sudah berjalan lebih dari 4 jam"
                        }));
                    }

                    tokio::time::sleep(tokio::time::Duration::from_secs(30 * 60)).await;
                }
            });

            // When launched at login (autostart passes `--minimized`), start
            // hidden in the tray instead of popping the window open.
            // An updater restart must open the new version even when the
            // original process was launched by autostart with --minimized.
            if take_update_restart(app.handle()) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            } else if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            Ok(())
        })
        // Closing the window hides it to the tray rather than quitting, so the
        // background scheduler stays alive. Full exit is via the tray "Keluar".
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Only hide-to-tray the main window; quick log window should
                // close normally.
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            test_connection, get_projects, search_issues, add_worklog, get_worklogs,
            activitywatch::check_activitywatch, activitywatch::get_aw_buckets, activitywatch::get_aw_events,
            get_my_worklogs, get_issue_children, get_project_epics, get_parents_with_children,
            create_issue, get_assignable_users, get_create_meta,
            update_worklog, delete_worklog,
            get_timer_state, start_timer, stop_timer, reset_timer, open_quicklog,
            update_tray_tooltip, prepare_update_restart, take_update_success
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        escape_jira_text_search, escape_jql_string, filter_issues_by_literal_summary,
        merge_issue_search_responses, needs_literal_summary_filter,
    };

    #[test]
    fn escapes_jira_text_operators_but_keeps_regular_punctuation_searchable() {
        assert_eq!(
            escape_jira_text_search(r#"OPS-12; "owner's" / daily"#),
            r#"OPS\-12; \"owner's\" \/ daily"#,
        );
    }

    #[test]
    fn safely_nests_a_text_query_inside_a_jql_string() {
        let text_query = format!(
            "{}*",
            escape_jira_text_search(r#"OPS-12; "owner's""#),
        );
        assert_eq!(
            escape_jql_string(&text_query),
            r#"OPS\\-12; \\\"owner's\\\"*"#,
        );
    }

    #[test]
    fn marks_special_character_queries_for_literal_matching() {
        assert!(needs_literal_summary_filter("Daily; sync"));
        assert!(needs_literal_summary_filter(";"));
        assert!(needs_literal_summary_filter("[IRQ-1460]"));
        assert!(needs_literal_summary_filter("1460"));
        assert!(!needs_literal_summary_filter("Daily sync"));
        assert!(needs_literal_summary_filter("BTPM-128"));
    }

    #[test]
    fn filters_punctuation_only_searches_against_summary_text() {
        let response = r#"{
          "issues": [
            {"key":"BTPM-1","fields":{"summary":"Planning; review"}},
            {"key":"BTPM-2","fields":{"summary":"Planning review"}}
          ]
        }"#;
        let filtered = filter_issues_by_literal_summary(response, ";").unwrap();
        let payload: serde_json::Value = serde_json::from_str(&filtered).unwrap();
        assert_eq!(payload["issues"].as_array().unwrap().len(), 1);
        assert_eq!(payload["issues"][0]["key"], "BTPM-1");
    }

    #[test]
    fn retains_real_issue_key_alongside_a_matching_summary_code() {
        let exact_key = r#"{"issues":[{"key":"IRQ-1460","fields":{"summary":"Real Jira issue"}}]}"#;
        let literal_summary = r#"{"issues":[{"key":"EVS-1178","fields":{"summary":"[IRQ-1460] Enhance"}}]}"#;
        let merged = merge_issue_search_responses(exact_key, literal_summary).unwrap();
        let payload: serde_json::Value = serde_json::from_str(&merged).unwrap();
        let keys: Vec<&str> = payload["issues"]
            .as_array()
            .unwrap()
            .iter()
            .map(|issue| issue["key"].as_str().unwrap())
            .collect();
        assert_eq!(keys, ["IRQ-1460", "EVS-1178"]);
    }
}
