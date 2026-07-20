// Model catalog: one full-precision variant per model, sized from a 78 MB
// preview up to a 3.1 GB max-accuracy build. The large-v3-turbo is the
// recommended default — it matches large-v3's accuracy at ~6x the speed.
//
// Sizes and sha256 sourced from the HF API for ggerganov/whisper.cpp.
// Re-fetch if filenames change upstream.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// A user-imported custom model. Each maps to a single `Quant::Full` variant
/// whose `.bin` file lives in `models_dir`. Persisted as `custom_models.json`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CustomModel {
    pub id: String,
    pub label: String,
    pub languages: String,
    pub filename: String,
}

fn custom_registry_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("custom_models.json")
}

/// Loads the custom-model registry. Missing or invalid file → empty list
/// (mirrors `config::load`).
pub fn list_custom(app_data_dir: &Path) -> Vec<CustomModel> {
    let path = custom_registry_path(app_data_dir);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_custom_registry(app_data_dir: &Path, models: &[CustomModel]) -> Result<(), String> {
    std::fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(models).map_err(|e| e.to_string())?;
    std::fs::write(custom_registry_path(app_data_dir), json).map_err(|e| e.to_string())
}

/// The full model list: built-in `catalog()` plus user-imported customs. Each
/// custom becomes a single `Quant::Full` variant sized from the file on disk
/// (0 if the file is missing — `is_installed` will report false and the
/// frontend won't offer it for transcription).
pub fn all_models(app_data_dir: &Path) -> Vec<ModelEntry> {
    let mut out = catalog();
    let dir = models_dir(app_data_dir);
    for cm in list_custom(app_data_dir) {
        let size_bytes = std::fs::metadata(dir.join(&cm.filename))
            .map(|m| m.len())
            .unwrap_or(0);
        out.push(ModelEntry {
            id: cm.id,
            label: cm.label,
            speed: "Custom".into(),
            accuracy: String::new(),
            languages: cm.languages,
            license: "Custom".into(),
            variants: vec![ModelVariant {
                quant: Quant::Full,
                filename: cm.filename,
                repo: String::new(),
                size_bytes,
                sha256: String::new(),
            }],
        });
    }
    out
}

/// Resolve a variant for either a built-in or a custom model. Tries the
/// built-in catalog first; if that misses and `model_id` starts with
/// `custom-`, looks the model up in the custom registry and builds a variant
/// from the file on disk.
pub fn find_variant_any(app_data_dir: &Path, model_id: &str, quant: Quant) -> Option<ModelVariant> {
    if let Some(v) = find_variant(model_id, quant) {
        return Some(v);
    }
    if !model_id.starts_with("custom-") {
        return None;
    }
    let cm = list_custom(app_data_dir).into_iter().find(|m| m.id == model_id)?;
    let size_bytes = std::fs::metadata(models_dir(app_data_dir).join(&cm.filename))
        .map(|m| m.len())
        .unwrap_or(0);
    Some(ModelVariant {
        quant: Quant::Full,
        filename: cm.filename,
        repo: String::new(),
        size_bytes,
        sha256: String::new(),
    })
}

/// Imports a user-supplied `.bin` file as a custom model: copies it into
/// `models_dir`, registers it in `custom_models.json`, returns the new id.
pub fn add_custom(
    app_data_dir: &Path,
    src_path: &str,
    label: &str,
    languages: &str,
) -> Result<String, String> {
    let label_trim = label.trim();
    if label_trim.is_empty() {
        return Err("label must not be empty".to_string());
    }
    let lower = src_path.to_ascii_lowercase();
    if !lower.ends_with(".bin") {
        return Err("source file must be a .bin file".to_string());
    }
    let src = std::path::Path::new(src_path);
    if !src.is_file() {
        return Err("source file does not exist".to_string());
    }

    let id = format!("custom-{}", uuid::Uuid::new_v4());
    let filename = format!("{id}.bin");

    let dir = models_dir(app_data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&filename);
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;

    let mut registry = list_custom(app_data_dir);
    registry.push(CustomModel {
        id: id.clone(),
        label: label_trim.to_string(),
        languages: languages.to_string(),
        filename,
    });
    save_custom_registry(app_data_dir, &registry)?;

    Ok(id)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Quant {
    Full,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelVariant {
    pub quant: Quant,
    pub filename: String,
    pub repo: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelEntry {
    pub id: String,
    pub label: String,
    pub speed: String,
    pub accuracy: String,
    pub languages: String,
    pub license: String,
    pub variants: Vec<ModelVariant>,
}

const WHISPER_CPP: &str = "ggerganov/whisper.cpp";

pub fn catalog() -> Vec<ModelEntry> {
    vec![
        ModelEntry {
            id: "tiny".into(), label: "Tiny".into(), speed: "Fastest".into(),
            accuracy: "Lowest".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                ModelVariant {
                    quant: Quant::Full,
                    filename: "ggml-tiny.bin".into(),
                    repo: WHISPER_CPP.into(),
                    size_bytes: 77691713,
                    sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21".into(),
                },
            ],
        },
        ModelEntry {
            id: "base".into(), label: "Base".into(), speed: "Very fast".into(),
            accuracy: "Low".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                ModelVariant {
                    quant: Quant::Full,
                    filename: "ggml-base.bin".into(),
                    repo: WHISPER_CPP.into(),
                    size_bytes: 147951465,
                    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe".into(),
                },
            ],
        },
        ModelEntry {
            id: "small".into(), label: "Small".into(), speed: "Fast".into(),
            accuracy: "Moderate".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                ModelVariant {
                    quant: Quant::Full,
                    filename: "ggml-small.bin".into(),
                    repo: WHISPER_CPP.into(),
                    size_bytes: 487601967,
                    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b".into(),
                },
            ],
        },
        ModelEntry {
            id: "large-v3-turbo".into(), label: "Large v3 Turbo".into(), speed: "Fast".into(),
            accuracy: "Very high".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                ModelVariant {
                    quant: Quant::Full,
                    filename: "ggml-large-v3-turbo.bin".into(),
                    repo: WHISPER_CPP.into(),
                    size_bytes: 1624555275,
                    sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69".into(),
                },
            ],
        },
        ModelEntry {
            id: "large-v3".into(), label: "Large v3".into(), speed: "Slowest".into(),
            accuracy: "Highest".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                ModelVariant {
                    quant: Quant::Full,
                    filename: "ggml-large-v3.bin".into(),
                    repo: WHISPER_CPP.into(),
                    size_bytes: 3095033483,
                    sha256: "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2".into(),
                },
            ],
        },
    ]
}

pub fn find_variant(model_id: &str, quant: Quant) -> Option<ModelVariant> {
    catalog()
        .into_iter()
        .find(|m| m.id == model_id)
        .and_then(|m| m.variants.into_iter().find(|v| v.quant == quant))
}

pub fn models_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("models")
}

pub fn installed_path(app_data_dir: &Path, variant: &ModelVariant) -> PathBuf {
    models_dir(app_data_dir).join(&variant.filename)
}

pub fn is_installed(app_data_dir: &Path, variant: &ModelVariant) -> bool {
    installed_path(app_data_dir, variant).is_file()
}

pub fn delete_model(app_data_dir: &Path, model_id: &str, quant: Quant) -> Result<(), String> {
    if let Some(variant) = find_variant(model_id, quant) {
        let path = installed_path(app_data_dir, &variant);
        if path.is_file() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    if model_id.starts_with("custom-") {
        let mut registry = list_custom(app_data_dir);
        if let Some(idx) = registry.iter().position(|m| m.id == model_id) {
            let filename = registry[idx].filename.clone();
            let path = models_dir(app_data_dir).join(&filename);
            if path.is_file() {
                std::fs::remove_file(path).map_err(|e| e.to_string())?;
            }
            registry.remove(idx);
            save_custom_registry(app_data_dir, &registry)?;
        }
        return Ok(());
    }
    Err("unknown model".to_string())
}

#[derive(Debug, Clone, Serialize)]
struct DownloadProgress {
    model_id: String,
    quant: String,
    downloaded: u64,
    total: u64,
}

/// Downloads a model variant with resume support: partial downloads live at
/// `<filename>.part` and resume via an HTTP Range request. Verified against
/// the known sha256 on completion before being renamed into place; a failed
/// checksum deletes the partial file rather than leaving a corrupt model.
pub async fn download_model(
    app: &AppHandle,
    app_data_dir: &Path,
    model_id: &str,
    quant: Quant,
) -> Result<(), String> {
    let variant = find_variant(model_id, quant).ok_or("unknown model/quant")?;
    let dir = models_dir(app_data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let final_path = installed_path(app_data_dir, &variant);
    if final_path.is_file() {
        return Ok(());
    }

    let part_path = dir.join(format!("{}.part", variant.filename));
    let already = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);

    let url = format!("https://huggingface.co/{}/resolve/main/{}", variant.repo, variant.filename);
    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    if already > 0 {
        req = req.header("Range", format!("bytes={already}-"));
    }
    let resp = req.send().await.map_err(|e| format!("download request failed: {e}"))?;
    if !resp.status().is_success() && resp.status().as_u16() != 206 {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let resumed = resp.status().as_u16() == 206;

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(&part_path)
        .map_err(|e| e.to_string())?;

    let mut downloaded = if resumed { already } else { 0 };
    let quant_str = serde_json::to_value(quant)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download stream error: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "model-download-progress",
            DownloadProgress {
                model_id: model_id.to_string(),
                quant: quant_str.clone(),
                downloaded,
                total: variant.size_bytes,
            },
        );
    }
    drop(file);

    let hash = sha256_file(&part_path)?;
    if hash != variant.sha256 {
        let _ = std::fs::remove_file(&part_path);
        return Err(format!(
            "checksum mismatch for {} (expected {}, got {hash}) — download removed, retry",
            variant.filename, variant.sha256
        ));
    }

    std::fs::rename(&part_path, &final_path).map_err(|e| e.to_string())?;
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
}
