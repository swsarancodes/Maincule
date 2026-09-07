import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace';
import { formatDisplayName } from '../../core/document/file-meta';

/**
 * Non-modal reconciliation banners for external file changes:
 * - syncConflict: disk changed under a dirty doc → Keep mine / Load disk
 * - syncDeleted: backing file deleted → Save it back / Keep open
 * Own saves never trigger these (hash + timestamp guards in the store).
 */
export const SyncBanner: React.FC<{ docId: string | null }> = ({ docId }) => {
  const doc = useWorkspaceStore((s) => s.documents.find((d) => d.id === docId));
  const resolveConflictKeepMine = useWorkspaceStore((s) => s.resolveConflictKeepMine);
  const resolveConflictLoadDisk = useWorkspaceStore((s) => s.resolveConflictLoadDisk);
  const saveBackDeletedFile = useWorkspaceStore((s) => s.saveBackDeletedFile);
  const dismissDeletedFile = useWorkspaceStore((s) => s.dismissDeletedFile);

  if (!doc || (!doc.syncConflict && !doc.syncDeleted)) return null;

  const name = formatDisplayName(doc.meta.fileName);
  const conflict = doc.syncConflict === true;

  return (
    <div
      role="alert"
      className="as-sync-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '7px 12px',
        fontSize: '12.5px',
        backgroundColor: conflict ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.10)',
        borderBottom: `1px solid ${conflict ? 'rgba(245, 158, 11, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
        color: 'var(--as-text)',
        flexShrink: 0,
      }}
    >
      {conflict ? (
        <AlertTriangle size={14} style={{ color: '#d97706', flexShrink: 0 }} />
      ) : (
        <Trash2 size={14} style={{ color: '#dc2626', flexShrink: 0 }} />
      )}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {conflict ? (
          <>‘{name}’ changed on disk while you had unsaved edits.</>
        ) : (
          <>‘{name}’ was deleted on disk.</>
        )}
      </span>
      {conflict ? (
        <>
          <button
            type="button"
            onClick={() => docId && resolveConflictKeepMine(docId)}
            style={btnStyle}
          >
            Keep mine
          </button>
          <button
            type="button"
            onClick={() => docId && resolveConflictLoadDisk(docId)}
            style={btnStyle}
          >
            Load disk
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => docId && saveBackDeletedFile(docId)}
            style={btnStyle}
          >
            Save it back
          </button>
          <button
            type="button"
            onClick={() => docId && dismissDeletedFile(docId)}
            style={btnStyle}
          >
            Keep open
          </button>
        </>
      )}
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: '4px',
  border: '1px solid var(--as-border)',
  backgroundColor: 'var(--as-bg-surface)',
  color: 'var(--as-text)',
  fontSize: '12px',
  fontWeight: 550,
  cursor: 'pointer',
  flexShrink: 0,
};
