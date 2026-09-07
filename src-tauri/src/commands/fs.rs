use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileReadResult {
    pub text: String,
    pub path: String,
    pub hash: String,
    pub mtime: u64,
    pub line_ending: LineEnding,
    pub has_bom: bool,
    pub final_newline: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileWriteResult {
    pub path: String,
    pub hash: String,
    pub mtime: u64,
}

fn compute_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn file_mtime(p: &Path) -> u64 {
    p.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Split raw bytes into editor text + fidelity metadata.
///
/// The BOM is stripped (the editor works BOM-free internally and re-adds it on
/// save); line-ending majority and trailing-newline presence are detected from
/// the raw bytes. Non-UTF8 input is rejected outright — lossy conversion would
/// silently corrupt binary files.
fn analyze_bytes(bytes: &[u8]) -> Result<(String, LineEnding, bool, bool), String> {
    const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
    let (has_bom, body) = match bytes.strip_prefix(BOM) {
        Some(rest) => (true, rest),
        None => (false, bytes),
    };
    let text = std::str::from_utf8(body)
        .map_err(|_| "File is not valid UTF-8 (binary files cannot be opened as notes)".to_string())?
        .to_string();

    let total_nl = text.matches('\n').count();
    let crlf = text.matches("\r\n").count();
    // CRLF-majority iff CRLF count beats lone-LF count (crlf > total - crlf).
    let line_ending = if crlf * 2 > total_nl {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    };
    let final_newline = text.ends_with('\n');

    Ok((text, line_ending, has_bom, final_newline))
}

/// Resolve `requested` (absolute or vault-relative) and require the result to
/// stay inside `root`. Lexically normalizes `..` so `vault/a/../../etc` can be
/// rejected even when the target does not exist yet.
pub fn resolve_in_vault(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let requested_path = Path::new(requested);
    let candidate = if requested_path.is_absolute() {
        requested_path.to_path_buf()
    } else {
        root.join(requested_path)
    };

    let needs_normalize = candidate
        .components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir));
    let normalized = if needs_normalize {
        let mut out = PathBuf::new();
        for comp in candidate.components() {
            match comp {
                Component::ParentDir => {
                    out.pop();
                }
                Component::CurDir => {}
                other => out.push(other.as_os_str()),
            }
        }
        out
    } else {
        candidate
    };

    if !normalized.starts_with(root) {
        return Err(format!(
            "Path escapes the vault: {}",
            Path::new(requested).display()
        ));
    }
    Ok(normalized)
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Unique temp path next to the target. The pid + counter suffix prevents two
/// concurrent saves (or a stale crash leftover) from colliding.
fn temp_path_for(target: &Path) -> Result<PathBuf, String> {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target.file_name().ok_or_else(|| {
        format!(
            "Invalid file path (no file name): {}",
            target.display()
        )
    })?;
    let unique = TEMP_COUNTER.fetch_add(1, Ordering::SeqCst);
    Ok(parent.join(format!(
        ".tmp_{}.{}.{}",
        name.to_string_lossy(),
        std::process::id(),
        unique
    )))
}

fn fsync_dir(dir: &Path) -> Result<(), String> {
    let handle = File::open(dir).map_err(|e| format!("Cannot open directory for fsync: {e}"))?;
    handle.sync_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileReadResult, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("File does not exist: {path}"));
    }

    let mut file = File::open(p).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let hash = compute_sha256(&bytes);

    let (text, line_ending, has_bom, final_newline) = analyze_bytes(&bytes)?;
    let mtime = file_mtime(p);

    Ok(FileReadResult {
        text,
        path,
        hash,
        mtime,
        line_ending,
        has_bom,
        final_newline,
    })
}

#[tauri::command]
pub fn write_file_atomic(
    path: String,
    contents: String,
    expected_hash: Option<String>,
) -> Result<FileWriteResult, String> {
    let target = Path::new(&path);

    // Optimistic-concurrency guard: refuse to overwrite a disk state we did
    // not base our edits on. The frontend turns this into a conflict banner.
    if let Some(expected) = expected_hash {
        if target.exists() {
            let mut file = File::open(target).map_err(|e| e.to_string())?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            if compute_sha256(&bytes) != expected {
                return Err("Conflict: file on disk was modified externally".to_string());
            }
        }
    }

    atomic_write_bytes(target, contents.as_bytes())?;

    let hash = compute_sha256(contents.as_bytes());
    let mtime = file_mtime(target);
    Ok(FileWriteResult { path, hash, mtime })
}

/// Binary twin of write_file_atomic for vault assets (images, …). Creates
/// missing parent directories (e.g. `.assets/`) and skips the text conflict
/// guard — assets are content-addressed by unique name instead.
#[tauri::command]
pub fn write_binary_atomic(path: String, bytes: Vec<u8>) -> Result<FileWriteResult, String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    atomic_write_bytes(target, &bytes)?;

    let hash = compute_sha256(&bytes);
    let mtime = file_mtime(target);
    Ok(FileWriteResult { path, hash, mtime })
}

/// Shared temp → fsync → rename → fsync-dir dance. Cleans up the temp file on
/// any failure so crashes never leave `.tmp_*` debris behind.
fn atomic_write_bytes(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let temp_path = temp_path_for(target)?;

    let write_result = (|| -> Result<(), String> {
        let mut temp_file = File::create(&temp_path).map_err(|e| e.to_string())?;
        temp_file.write_all(bytes).map_err(|e| e.to_string())?;
        temp_file.sync_all().map_err(|e| e.to_string())?;
        drop(temp_file);
        fs::rename(&temp_path, target).map_err(|e| e.to_string())?;
        fsync_dir(parent)?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

// ---------------------------------------------------------------------------
// Vault: an opened folder whose tree the sidebar mirrors. All vault-relative
// resolutions are contained via resolve_in_vault.
// ---------------------------------------------------------------------------

/// The canonicalized vault root picked via the native open-folder dialog.
/// `None` until the user opens a folder (browser build never sets it).
pub struct VaultState(pub Mutex<Option<PathBuf>>);

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VaultEntryKind {
    File,
    Dir,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct VaultEntry {
    /// Absolute path on disk.
    pub path: String,
    /// Vault-relative path with `/` separators (stable tree key).
    pub rel: String,
    /// File or directory name.
    pub name: String,
    pub kind: VaultEntryKind,
}

#[tauri::command]
pub fn set_vault_root(
    state: tauri::State<VaultState>,
    path: String,
) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }
    let canon = p.canonicalize().map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(canon.clone());
    Ok(canon.to_string_lossy().to_string())
}

const VAULT_SCAN_LIMIT: usize = 20_000;

fn is_markdown(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// Recursive vault scan: markdown files + the directories containing them.
/// Skips hidden entries (`.git`, `.DS_Store`, `.assets`, …), symlinks (cycle
/// risk), and stops at VAULT_SCAN_LIMIT entries.
fn scan_vault_dir(root: &Path) -> Result<Vec<VaultEntry>, String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let rel_dir = dir
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if dir != root {
            let name = dir
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            out.push(VaultEntry {
                path: dir.to_string_lossy().to_string(),
                rel: rel_dir.clone(),
                name,
                kind: VaultEntryKind::Dir,
            });
        }

        let rd = fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for entry in rd {
            let entry = entry.map_err(|e| e.to_string())?;
            let ft = entry
                .file_type()
                .map_err(|e| e.to_string())?;
            // Never follow symlinks: a linked ancestor would loop the scan.
            if ft.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let child = entry.path();
            if ft.is_dir() {
                stack.push(child);
            } else if ft.is_file() && is_markdown(&name) {
                let rel = child
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(VaultEntry {
                    path: child.to_string_lossy().to_string(),
                    rel,
                    name,
                    kind: VaultEntryKind::File,
                });
            }
            if out.len() >= VAULT_SCAN_LIMIT {
                break;
            }
        }
        if out.len() >= VAULT_SCAN_LIMIT {
            break;
        }
    }

    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

#[tauri::command]
pub fn read_vault_dir(state: tauri::State<VaultState>) -> Result<Vec<VaultEntry>, String> {
    let root = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No vault open. Open a folder first.".to_string())?;
    scan_vault_dir(&root)
}

/// Move a vault file or directory to the OS Trash/Recycle Bin. Scoped to the
/// vault root via `resolve_in_vault`; symlinks are never followed (the scan
/// never surfaces them, so a request for one is rejected). Returns the
/// trashed entry's display name for the frontend confirmation.
fn move_to_trash(root: &Path, requested: &str) -> Result<String, String> {
    let target = resolve_in_vault(root, requested)?;
    if target == *root {
        return Err("Refusing to trash the vault root itself".to_string());
    }
    if target.is_symlink() {
        return Err(format!(
            "Refusing to trash a symlink: {}",
            Path::new(requested).display()
        ));
    }
    if !target.exists() {
        return Err(format!("Not found: {}", Path::new(requested).display()));
    }
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    trash::delete(&target).map_err(|e| e.to_string())?;
    Ok(name)
}

#[tauri::command]
pub fn delete_to_trash(
    state: tauri::State<VaultState>,
    path: String,
) -> Result<String, String> {
    let root = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No vault open. Open a folder first.".to_string())?;
    move_to_trash(&root, &path)
}

// ---------------------------------------------------------------------------
// Live watcher: forwards vault file events to the frontend (`vault://file-changed`).
// The frontend debounces per path, skips our own saves, and reconciles.
// ---------------------------------------------------------------------------

/// Owns the active watcher so re-watching (or closing the vault) drops the old
/// one instead of stacking duplicate event streams.
pub struct VaultWatchState(pub Mutex<Option<notify::RecommendedWatcher>>);

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VaultChangePayload {
    pub path: String,
    pub kind: String,
}

#[tauri::command]
pub fn start_vault_watch(
    app: tauri::AppHandle,
    watch_state: tauri::State<VaultWatchState>,
    vault_state: tauri::State<VaultState>,
) -> Result<(), String> {
    let root = vault_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No vault open. Open a folder first.".to_string())?;

    let mut guard = watch_state.0.lock().map_err(|e| e.to_string())?;
    // Dropping the previous watcher stops its event stream and its thread.
    *guard = None;

    let (tx, rx) = std::sync::mpsc::channel::<notify::Event>();
    let mut watcher = notify::recommended_watcher(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
    )
    .map_err(|e| e.to_string())?;
    use notify::Watcher;
    watcher
        .watch(&root, notify::RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Forward on a dedicated thread; it exits when the watcher is dropped and
    // the channel disconnects.
    std::thread::spawn(move || {
        use tauri::Emitter;
        for event in rx {
            let kind = match event.kind {
                notify::EventKind::Create(_) => "created",
                notify::EventKind::Modify(_) => "modified",
                notify::EventKind::Remove(_) => "removed",
                _ => continue,
            };
            for path in event.paths {
                let payload = VaultChangePayload {
                    path: path.to_string_lossy().to_string(),
                    kind: kind.to_string(),
                };
                let _ = app.emit("vault://file-changed", payload);
            }
        }
    });

    *guard = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn stop_vault_watch(watch_state: tauri::State<VaultWatchState>) -> Result<(), String> {
    *watch_state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

#[cfg(test)]
mod tests {    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "manicule_fs_test_{tag}_{}_{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    #[test]
    fn read_detects_crlf_bom_and_missing_final_newline() {
        let dir = unique_dir("meta");
        // BOM + CRLF + no trailing newline
        let bytes = b"\xEF\xBB\xBF# Title\r\nbody line";
        let path = dir.join("note.md");
        fs::write(&path, bytes).unwrap();

        let result = read_file(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(result.text, "# Title\r\nbody line");
        assert_eq!(result.line_ending, LineEnding::Crlf);
        assert!(result.has_bom);
        assert!(!result.final_newline);
        assert_eq!(result.hash, compute_sha256(bytes));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_is_byte_identical_round_trip() {
        let dir = unique_dir("roundtrip");
        let path = dir.join("note.md");
        let original = "\u{FEFF}# Title\r\nbody line\r\n";
        fs::write(&path, original.as_bytes()).unwrap();

        let read = read_file(path.to_string_lossy().to_string()).unwrap();
        // Simulate the frontend: strip BOM for editing, re-add + CRLF on save.
        let edited = read.text.replace("\r\n", "\n");
        let to_save = format!("\u{FEFF}{}", edited.replace('\n', "\r\n"));
        write_file_atomic(
            path.to_string_lossy().to_string(),
            to_save,
            Some(read.hash),
        )
        .unwrap();

        assert_eq!(fs::read(&path).unwrap(), original.as_bytes());
        assert!(dir.read_dir().unwrap().all(|e| {
            !e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".tmp_")
        }));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn binary_write_creates_parents_and_round_trips_bytes() {
        let dir = unique_dir("binary_write");
        let target = dir.join(".assets").join("img-a1b2c3.png");
        let bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0xFE];

        let res = write_binary_atomic(
            target.to_string_lossy().to_string(),
            bytes.clone(),
        )
        .unwrap();
        assert_eq!(res.hash, compute_sha256(&bytes));
        assert_eq!(fs::read(&target).unwrap(), bytes);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_rejects_non_utf8() {
        let dir = unique_dir("binary");
        let path = dir.join("img.bin");
        fs::write(&path, [0x89, 0x50, 0x4E, 0x47, 0xFF, 0xFE]).unwrap();

        let err = read_file(path.to_string_lossy().to_string()).unwrap_err();
        assert!(err.contains("not valid UTF-8"), "unexpected: {err}");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_conflicts_on_external_modification() {
        let dir = unique_dir("conflict");
        let path = dir.join("note.md");
        fs::write(&path, b"original").unwrap();
        let read = read_file(path.to_string_lossy().to_string()).unwrap();

        // External edit (e.g. Vim) lands on disk first.
        fs::write(&path, b"externally edited").unwrap();

        let err = write_file_atomic(
            path.to_string_lossy().to_string(),
            "stale save".to_string(),
            Some(read.hash),
        )
        .unwrap_err();
        assert!(err.contains("Conflict"), "unexpected: {err}");
        // Losing save must not have clobbered the external edit.
        assert_eq!(fs::read(&path).unwrap(), b"externally edited");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn invalid_paths_error_without_panicking() {
        // No file name: temp_path_for must error, not unwrap-panic.
        assert!(temp_path_for(Path::new("/")).is_err());
        assert!(read_file("/definitely/not/here/missing.md".to_string()).is_err());

        // Failed write leaves no temp debris.
        let dir = unique_dir("debris");
        let bad = dir.join("no-such-dir").join("note.md");
        assert!(write_file_atomic(bad.to_string_lossy().to_string(), "x".to_string(), None).is_err());
        assert!(dir.read_dir().unwrap().all(|e| {
            !e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".tmp_")
        }));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_in_vault_blocks_escape() {
        let root = Path::new("/vault");
        assert!(resolve_in_vault(root, "notes/a.md").is_ok());
        assert!(resolve_in_vault(root, "/vault/notes/a.md").is_ok());
        assert!(resolve_in_vault(root, "../etc/passwd").is_err());
        assert!(resolve_in_vault(root, "a/../../etc/passwd").is_err());
        assert!(resolve_in_vault(root, "/etc/passwd").is_err());
    }

    #[test]
    fn vault_scan_lists_markdown_and_skips_hidden_and_foreign_files() {        let dir = unique_dir("vault");
        fs::create_dir_all(dir.join("notes/sub")).unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join("root.md"), b"# root").unwrap();
        fs::write(dir.join("notes/a.md"), b"# a").unwrap();
        fs::write(dir.join("notes/sub/b.markdown"), b"# b").unwrap();
        fs::write(dir.join("notes/image.png"), b"fake").unwrap();
        fs::write(dir.join("notes/.hidden.md"), b"# hidden").unwrap();
        fs::write(dir.join(".git/inner.md"), b"# hidden").unwrap();

        let state = VaultState(Mutex::new(Some(dir.clone())));
        assert!(state.0.lock().unwrap().is_some());
        let entries = scan_vault_dir(&dir).expect("scan vault");

        let files: Vec<&str> = entries
            .iter()
            .filter(|e| e.kind == VaultEntryKind::File)
            .map(|e| e.rel.as_str())
            .collect();
        assert_eq!(files, vec!["notes/a.md", "notes/sub/b.markdown", "root.md"]);

        let dirs: Vec<&str> = entries
            .iter()
            .filter(|e| e.kind == VaultEntryKind::Dir)
            .map(|e| e.rel.as_str())
            .collect();
        assert!(dirs.contains(&"notes"));
        assert!(dirs.contains(&"notes/sub"));
        assert!(!dirs.iter().any(|d| d.contains(".git")));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn trash_moves_file_out_of_vault() {
        let dir = unique_dir("trash_file");
        fs::write(dir.join("gone.md"), b"# gone").unwrap();
        fs::write(dir.join("kept.md"), b"# kept").unwrap();

        let name = move_to_trash(&dir, "gone.md").expect("trash file");
        assert_eq!(name, "gone.md");
        assert!(!dir.join("gone.md").exists());
        assert!(dir.join("kept.md").exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn trash_moves_directory_recursively() {
        let dir = unique_dir("trash_dir");
        fs::create_dir_all(dir.join("notes/sub")).unwrap();
        fs::write(dir.join("notes/a.md"), b"# a").unwrap();

        let name = move_to_trash(&dir, "notes").expect("trash dir");
        assert_eq!(name, "notes");
        assert!(!dir.join("notes").exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn trash_rejects_escape_root_and_missing() {
        let dir = unique_dir("trash_scope");
        fs::write(dir.join("a.md"), b"# a").unwrap();

        assert!(move_to_trash(&dir, "../etc/passwd").is_err());
        assert!(move_to_trash(&dir, "a/../../etc/passwd").is_err());
        assert!(move_to_trash(&dir, "/etc/passwd").is_err());
        assert!(move_to_trash(&dir, "nope.md").is_err());
        // The vault root itself is never trashable.
        assert!(move_to_trash(&dir, ".").is_err());

        // Rejected trashes leave the vault untouched.
        assert!(dir.join("a.md").exists());

        fs::remove_dir_all(&dir).ok();
    }
}
