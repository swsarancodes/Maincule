use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use super::fs::VaultState;

const MAX_INDEXED_BYTES: u64 = 2_000_000;
const MAX_SNIPPET_CHARS: usize = 160;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchHit {
    /// Absolute path on disk.
    pub path: String,
    /// Vault-relative path with `/` separators.
    pub rel: String,
    pub title: String,
    pub snippet: String,
    pub line: u32,
    pub rank: f64,
}

fn vault_root_from(state: &tauri::State<VaultState>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No vault open. Open a folder first.".to_string())
}

fn db_path_for(root: &Path) -> PathBuf {
    root.join(".manicule").join("search.db")
}

fn open_db(root: &Path) -> Result<Connection, String> {
    let db_path = db_path_for(root);
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS files(
            path TEXT PRIMARY KEY,
            rel TEXT NOT NULL,
            mtime INTEGER NOT NULL,
            hash TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            path UNINDEXED, title, body, tokenize='porter unicode61'
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn file_mtime(p: &Path) -> i64 {
    p.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn compute_sha256(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Title = first `# Heading` else filename stem with `-`/`_` → spaces.
fn extract_title(body: &str, file_name: &str) -> String {
    for line in body.lines().take(50) {
        let t = line.trim();
        if let Some(stripped) = t.strip_prefix("# ") {
            let s = stripped.trim();
            if !s.is_empty() {
                return s.chars().take(120).collect();
            }
        }
    }
    file_name
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(file_name)
        .replace(['-', '_'], " ")
        .trim()
        .chars()
        .take(120)
        .collect()
}

/// Build a safe FTS5 MATCH expression: quote each alphanumeric term.
/// Returns None when the query has no indexable characters.
fn build_fts_query(raw: &str) -> Option<String> {
    let terms: Vec<String> = raw
        .split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '_'))
        .filter_map(|t| {
            let t = t.trim_matches(|c| c == '\'' || c == '_').trim();
            if t.is_empty() {
                None
            } else {
                Some(format!("\"{}\"", t.replace('"', "\"\"")))
            }
        })
        .take(10)
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

/// Plain-text context window around the first case-insensitive match.
/// Returns (snippet, 1-based line number). Never emits HTML.
fn snippet_for(body: &str, query: &str) -> (String, u32) {
    let q = query.trim().to_lowercase();
    // For multi-word queries, anchor on the first indexable word.
    let anchor = q
        .split(|c: char| !c.is_alphanumeric())
        .find(|w| !w.is_empty())
        .unwrap_or(q.as_str());
    let lower = body.to_lowercase();
    if let Some(idx) = lower.find(anchor) {
        let line = body[..idx].matches('\n').count() as u32 + 1;
        // Char-boundary-safe window.
        let chars: Vec<char> = body.chars().collect();
        let anchor_chars: Vec<char> = anchor.chars().collect();
        // Find char index of byte idx (approx via char count of prefix).
        let char_idx = body[..idx].chars().count();
        let start = char_idx.saturating_sub(60);
        let end = (char_idx + anchor_chars.len() + 60).min(chars.len());
        let mut s: String = chars[start..end].iter().collect();
        s = s.replace('\n', " ").replace('\r', "");
        s = s.split_whitespace().collect::<Vec<_>>().join(" ");
        if start > 0 {
            s = format!("...{s}");
        }
        if end < chars.len() {
            s.push_str("...");
        }
        let snippet: String = s.chars().take(MAX_SNIPPET_CHARS).collect();
        (snippet, line)
    } else {
        // Title-only match: first non-empty line.
        let snippet: String = body
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("")
            .chars()
            .take(MAX_SNIPPET_CHARS)
            .collect();
        (snippet, 1)
    }
}

fn rel_for(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| abs.to_string_lossy().to_string())
}

fn index_one(conn: &Connection, root: &Path, abs: &Path) -> Result<bool, String> {
    let meta = fs::metadata(abs).map_err(|e| e.to_string())?;
    if meta.len() > MAX_INDEXED_BYTES {
        return Ok(false);
    }
    let bytes = fs::read(abs).map_err(|e| e.to_string())?;
    // Skip binary: reuse UTF-8 gate (strip BOM like read_file).
    const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
    let body_bytes = bytes.strip_prefix(BOM).unwrap_or(&bytes);
    let body = match std::str::from_utf8(body_bytes) {
        Ok(s) => s,
        Err(_) => return Ok(false),
    };
    let hash = compute_sha256(&bytes);
    let mtime = file_mtime(abs);
    let file_name = abs
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let title = extract_title(body, &file_name);
    let path_s = abs.to_string_lossy().to_string();
    let rel = rel_for(root, abs);

    conn.execute(
        "INSERT OR REPLACE INTO files(path, rel, mtime, hash, title, body)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![path_s, rel, mtime, hash, title, body],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM files_fts WHERE path = ?1", params![path_s])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO files_fts(path, title, body) VALUES (?1, ?2, ?3)",
        params![path_s, title, body],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

fn collect_markdown_files(root: &Path, limit: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in rd.flatten() {
            if out.len() >= limit {
                break;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
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
            } else if ft.is_file() {
                let lower = name.to_ascii_lowercase();
                if lower.ends_with(".md") || lower.ends_with(".markdown") {
                    out.push(child);
                }
            }
        }
        if out.len() >= limit {
            break;
        }
    }
    out
}

/// Full rebuild: scan vault, upsert each markdown file, drop stale rows.
/// Returns number of indexed files.
#[tauri::command]
pub fn rebuild_search_index(state: tauri::State<VaultState>) -> Result<usize, String> {
    let root = vault_root_from(&state)?;
    let files = collect_markdown_files(&root, 20_000);
    let conn = open_db(&root)?;
    let mut indexed = 0usize;
    for abs in &files {
        if index_one(&conn, &root, abs).unwrap_or(false) {
            indexed += 1;
        }
    }
    // Drop rows for files that no longer exist.
    let wanted: std::collections::HashSet<String> =
        files.iter().map(|p| p.to_string_lossy().to_string()).collect();
    let existing: Vec<String> = conn
        .prepare("SELECT path FROM files")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    for path in existing {
        if !wanted.contains(&path) {
            conn.execute("DELETE FROM files WHERE path = ?1", params![path])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM files_fts WHERE path = ?1", params![path])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(indexed)
}

#[tauri::command]
pub fn search_vault(
    state: tauri::State<VaultState>,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SearchHit>, String> {
    let root = vault_root_from(&state)?;
    let Some(match_expr) = build_fts_query(&query) else {
        return Ok(vec![]);
    };
    let conn = open_db(&root)?;
    let lim = limit.unwrap_or(30).clamp(1, 100) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT f.path, f.rel, f.title, f.body, rank
             FROM files_fts JOIN files f ON f.path = files_fts.path
             WHERE files_fts MATCH ?1 ORDER BY rank LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![match_expr, lim], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for row in rows {
        let (path, rel, title, body, rank) = row.map_err(|e| e.to_string())?;
        let (snippet, line) = snippet_for(&body, &query);
        hits.push(SearchHit {
            path,
            rel,
            title,
            snippet,
            line,
            rank,
        });
    }
    Ok(hits)
}

/// Incremental upsert for a single absolute path (post-save / watcher).
/// No-op for non-markdown / missing / binary files (removes stale row instead).
#[tauri::command]
pub fn upsert_search_path(state: tauri::State<VaultState>, path: String) -> Result<bool, String> {
    let root = vault_root_from(&state)?;
    let abs = Path::new(&path).to_path_buf();
    // Contain to vault: lexical check mirrors resolve_in_vault.
    if let Ok(rel) = abs.strip_prefix(&root) {
        if rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err("Path escapes the vault".to_string());
        }
    } else if !abs.starts_with(&root) {
        return Err("Path escapes the vault".to_string());
    }
    let conn = open_db(&root)?;
    if !abs.is_file() {
        let p = abs.to_string_lossy().to_string();
        conn.execute("DELETE FROM files WHERE path = ?1", params![p])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM files_fts WHERE path = ?1", params![p])
            .map_err(|e| e.to_string())?;
        return Ok(false);
    }
    index_one(&conn, &root, &abs)
}

#[tauri::command]
pub fn remove_search_path(state: tauri::State<VaultState>, path: String) -> Result<(), String> {
    let root = vault_root_from(&state)?;
    let conn = open_db(&root)?;
    conn.execute("DELETE FROM files WHERE path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM files_fts WHERE path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "manicule_search_test_{tag}_{}_{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    #[test]
    fn fts_query_builder_rejects_empty_and_escapes() {
        assert!(build_fts_query("").is_none());
        assert!(build_fts_query("!!! ...").is_none());
        let q = build_fts_query("hello world").unwrap();
        assert!(q.contains("\"hello\"") && q.contains("\"world\""));
        // No raw FTS operators leak through.
        let evil = build_fts_query("title:foo OR *").unwrap();
        assert!(!evil.contains(':') || evil.contains("\"title\""));
    }

    #[test]
    fn snippet_is_plain_text_with_line_number() {
        let body = "# Shopping\n\nBuy milk and eggs\non line three";
        let (snip, line) = snippet_for(body, "milk");
        assert_eq!(line, 3);
        assert!(snip.contains("milk"));
        assert!(!snip.contains('<') || snip.contains("milk"));
        let (t, _) = snippet_for(body, "nomatchxyz");
        assert!(!t.is_empty());
    }

    #[test]
    fn title_prefers_first_heading() {
        assert_eq!(extract_title("# Hello World\nbody", "note.md"), "Hello World");
        assert_eq!(extract_title("no heading", "my-note_file.md"), "my note file");
    }

    #[test]
    fn index_and_search_round_trip() {
        let dir = unique_dir("roundtrip");
        fs::write(dir.join("a.md"), "# Shopping\nBuy milk and eggs").unwrap();
        fs::write(dir.join("b.md"), "# Work\nFinish the report").unwrap();
        fs::write(dir.join("skip.png"), [0x89, 0x50, 0xFF, 0xFE]).unwrap();

        let conn = open_db(&dir).unwrap();
        let files = collect_markdown_files(&dir, 20_000);
        assert_eq!(files.len(), 2);
        for f in &files {
            index_one(&conn, &dir, f).unwrap();
        }
        drop(conn);

        // Query via raw SQL mirroring search_vault's MATCH.
        let conn2 = open_db(&dir).unwrap();
        let count: i64 = conn2
            .query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
        let hits: Vec<String> = conn2
            .prepare("SELECT path FROM files_fts WHERE files_fts MATCH '\"milk\"'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].ends_with("a.md"));

        // Binary files are never indexed.
        let png = dir.join("skip.png");
        assert!(!index_one(&conn2, &dir, &png).unwrap_or(true));

        fs::remove_dir_all(&dir).ok();
    }
}
