use serde::{Deserialize, Serialize};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraConfig {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
    pub is_cloud: bool,
}

impl JiraConfig {
    pub fn auth_header(&self) -> String {
        let credentials = format!("{}:{}", self.email, self.api_token);
        format!("Basic {}", STANDARD.encode(credentials))
    }
    pub fn api_base(&self) -> String {
        format!("{}/rest/api/2", self.base_url.trim_end_matches('/'))
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraUser {
    #[serde(alias = "displayName")]
    pub display_name: String,
    #[serde(alias = "emailAddress", default)]
    pub email_address: Option<String>,
    #[serde(alias = "accountId", default)]
    pub account_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraProject {
    pub id: String,
    pub key: String,
    pub name: String,
}

// Catatan: tidak ada tipe untuk respons pencarian issue di sini.
//
// `search_issues`, `get_project_epics`, dan `get_create_meta` mengembalikan
// `Result<String, String>` — JSON mentah diteruskan apa adanya, dan frontend
// yang mem-parsingnya di `searchStore.ts`. Struct `JiraIssue`, `IssueType`,
// dan `SearchResult` dulu ada di sini tetapi tidak pernah tersambung ke satu
// pun perintah, jadi ia hanya kontrak kedua yang bisa diam-diam menyimpang
// dari yang sungguhan. Kalau suatu saat parsing dipindahkan ke Rust, tipenya
// dibuat berbarengan dengan pemakaiannya.

#[derive(Debug, Serialize, Deserialize)]
pub struct Worklog {
    pub id: Option<String>,
    #[serde(alias = "timeSpentSeconds")]
    pub time_spent_seconds: u64,
    #[serde(default)]
    pub started: Option<String>,
    #[serde(default)]
    pub comment: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorklogResponse {
    pub worklogs: Vec<Worklog>,
    pub total: u32,
}
