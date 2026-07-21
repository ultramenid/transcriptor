// Settings persistence (no secrets - no cloud).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub default_model_id: Option<String>,
    pub default_quant: Option<String>,
    pub default_language: String,
    pub output_dir: Option<String>,
    pub copy_source_into_library: bool,
    /// Contact GitHub for a new release on launch. The only automatic network
    /// call this app makes, so it is a setting rather than a hard-coded yes.
    #[serde(default = "default_true")]
    pub auto_check_updates: bool,
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_model_id: None,
            default_quant: None,
            default_language: "auto".to_string(),
            output_dir: None,
            copy_source_into_library: false,
            auto_check_updates: true,
        }
    }
}

fn config_path(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("config.json")
}

pub fn load(app_data_dir: &std::path::Path) -> Settings {
    let path = config_path(app_data_dir);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app_data_dir: &std::path::Path, settings: &Settings) -> Result<(), String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(config_path(app_data_dir), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_missing_returns_defaults() {
        let dir = std::env::temp_dir().join(format!("transcriptor-config-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let settings = load(&dir);
        assert_eq!(settings.default_language, "auto");
        assert!(settings.output_dir.is_none());
        assert!(!settings.copy_source_into_library);
        // Config files written before this setting existed must still load.
        assert!(settings.auto_check_updates);
    }

    #[test]
    fn save_and_load_round_trips() {
        let dir = std::env::temp_dir().join(format!("transcriptor-config-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let settings = Settings {
            default_model_id: Some("large-v3-turbo".to_string()),
            default_quant: Some("compact".to_string()),
            default_language: "en".to_string(),
            output_dir: Some("/tmp/exports".to_string()),
            copy_source_into_library: true,
            auto_check_updates: false,
        };
        save(&dir, &settings).unwrap();
        let loaded = load(&dir);
        assert_eq!(loaded.default_model_id, Some("large-v3-turbo".to_string()));
        assert_eq!(loaded.default_quant, Some("compact".to_string()));
        assert_eq!(loaded.default_language, "en");
        assert_eq!(loaded.output_dir, Some("/tmp/exports".to_string()));
        assert!(loaded.copy_source_into_library);
        assert!(!loaded.auto_check_updates);
    }
}
