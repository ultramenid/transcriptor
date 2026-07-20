// Model catalog + first-run picker + download/list/delete (ggml from HuggingFace).
// Sizes and sha256 sourced from the HF API for ggerganov/whisper.cpp and
// distil-whisper/distil-large-v3-ggml — re-fetch if variants change upstream.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Quant {
    Compact,
    Balanced,
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

macro_rules! v {
    ($quant:ident, $file:expr, $repo:expr, $size:expr, $sha:expr) => {
        ModelVariant {
            quant: Quant::$quant,
            filename: $file.to_string(),
            repo: $repo.to_string(),
            size_bytes: $size,
            sha256: $sha.to_string(),
        }
    };
}

const WHISPER_CPP: &str = "ggerganov/whisper.cpp";
const DISTIL_LARGE_V3: &str = "distil-whisper/distil-large-v3-ggml";

pub fn catalog() -> Vec<ModelEntry> {
    vec![
        ModelEntry {
            id: "tiny".into(), label: "Tiny".into(), speed: "Fastest".into(),
            accuracy: "Lowest".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                v!(Compact, "ggml-tiny-q5_1.bin", WHISPER_CPP, 32152673u64, "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7"),
                v!(Balanced, "ggml-tiny-q8_0.bin", WHISPER_CPP, 43537433u64, "c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca"),
                v!(Full, "ggml-tiny.bin", WHISPER_CPP, 77691713u64, "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"),
            ],
        },
        ModelEntry {
            id: "base".into(), label: "Base".into(), speed: "Very fast".into(),
            accuracy: "Low".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                v!(Compact, "ggml-base-q5_1.bin", WHISPER_CPP, 59707625u64, "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"),
                v!(Balanced, "ggml-base-q8_0.bin", WHISPER_CPP, 81768585u64, "c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9"),
                v!(Full, "ggml-base.bin", WHISPER_CPP, 147951465u64, "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"),
            ],
        },
        ModelEntry {
            id: "small".into(), label: "Small".into(), speed: "Fast".into(),
            accuracy: "Moderate".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                v!(Compact, "ggml-small-q5_1.bin", WHISPER_CPP, 190085487u64, "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"),
                v!(Balanced, "ggml-small-q8_0.bin", WHISPER_CPP, 264464607u64, "49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f"),
                v!(Full, "ggml-small.bin", WHISPER_CPP, 487601967u64, "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"),
            ],
        },
        ModelEntry {
            id: "medium".into(), label: "Medium".into(), speed: "Moderate".into(),
            accuracy: "High".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                v!(Compact, "ggml-medium-q5_0.bin", WHISPER_CPP, 539212467u64, "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f"),
                v!(Balanced, "ggml-medium-q8_0.bin", WHISPER_CPP, 823369779u64, "42a1ffcbe4167d224232443396968db4d02d4e8e87e213d3ee2e03095dea6502"),
                v!(Full, "ggml-medium.bin", WHISPER_CPP, 1533763059u64, "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208"),
            ],
        },
        ModelEntry {
            id: "large-v3-turbo".into(), label: "Large v3 Turbo".into(), speed: "Fast".into(),
            accuracy: "Very high".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                v!(Compact, "ggml-large-v3-turbo-q5_0.bin", WHISPER_CPP, 574041195u64, "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2"),
                v!(Balanced, "ggml-large-v3-turbo-q8_0.bin", WHISPER_CPP, 874188075u64, "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1"),
                v!(Full, "ggml-large-v3-turbo.bin", WHISPER_CPP, 1624555275u64, "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69"),
            ],
        },
        ModelEntry {
            id: "large-v3".into(), label: "Large v3".into(), speed: "Slowest".into(),
            accuracy: "Highest".into(), languages: "Multilingual".into(), license: "MIT".into(),
            variants: vec![
                v!(Compact, "ggml-large-v3-q5_0.bin", WHISPER_CPP, 1081140203u64, "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1"),
                v!(Full, "ggml-large-v3.bin", WHISPER_CPP, 3095033483u64, "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2"),
            ],
        },
        ModelEntry {
            id: "distil-large-v3".into(), label: "Distil Large v3".into(), speed: "Fast".into(),
            accuracy: "High".into(), languages: "English only".into(), license: "MIT".into(),
            variants: vec![
                v!(Full, "ggml-distil-large-v3.bin", DISTIL_LARGE_V3, 1519521155u64, "2883a11b90fb10ed592d826edeaee7d2929bf1ab985109fe9e1e7b4d2b69a298"),
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
    let variant = find_variant(model_id, quant).ok_or("unknown model/quant")?;
    let path = installed_path(app_data_dir, &variant);
    if path.is_file() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
struct DownloadProgress {
    model_id: String,
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
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download stream error: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "model-download-progress",
            DownloadProgress { model_id: model_id.to_string(), downloaded, total: variant.size_bytes },
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
