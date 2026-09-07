import React, { useState, useEffect, useRef } from 'react';
import { Upload, Globe, Image as ImageIcon, X, Check, AlertCircle } from 'lucide-react';

export interface ImageModalProps {
  isOpen: boolean;
  initialAlt?: string;
  initialUrl?: string;
  initialTitle?: string;
  onClose: () => void;
  onConfirm: (alt: string, url: string, title?: string) => void;
}

export const ImageModal: React.FC<ImageModalProps> = ({
  isOpen,
  initialAlt = '',
  initialUrl = '',
  initialTitle = '',
  onClose,
  onConfirm,
}) => {
  const [tab, setTab] = useState<'upload' | 'url'>('url');
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [title, setTitle] = useState('');
  const [previewError, setPreviewError] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setUrl(initialUrl || '');
      setAlt(initialAlt || '');
      setTitle(initialTitle || '');
      setPreviewError(false);
      setTab(initialUrl.startsWith('data:image/') ? 'upload' : 'url');
      setTimeout(() => {
        if (!initialUrl) {
          urlInputRef.current?.focus();
        }
      }, 50);
    }
  }, [isOpen, initialUrl, initialAlt, initialTitle]);

  if (!isOpen) return null;

  const handleProcessFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setUrl(dataUrl);
      setPreviewError(false);
      if (!alt) {
        setAlt(file.name.replace(/\.[^/.]+$/, ''));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleProcessFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleProcessFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onConfirm(alt.trim() || 'Image', url.trim(), title.trim() || undefined);
    onClose();
  };

  return (
    <div
      className="as-image-modal"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--as-bg-surface)',
          color: 'var(--as-text)',
          borderRadius: 'var(--as-radius-lg)',
          boxShadow: 'var(--as-shadow-lg)',
          border: '1px solid var(--as-border)',
          width: '460px',
          maxWidth: 'calc(100vw - 32px)',
          overflow: 'hidden',
          animation: 'popIn 0.16s cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--as-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ImageIcon size={18} style={{ color: 'var(--as-accent)' }} />
            <span style={{ fontWeight: 650, fontSize: '14.5px' }}>
              {initialUrl ? 'Edit Image' : 'Insert Image'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--as-text-muted)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: 'var(--as-radius-sm)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--as-border)',
            backgroundColor: 'var(--as-bg-subtle)',
          }}
        >
          <button
            type="button"
            onClick={() => setTab('url')}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: tab === 'url' ? 'var(--as-bg-surface)' : 'transparent',
              border: 'none',
              borderBottom: tab === 'url' ? '2px solid var(--as-accent)' : '2px solid transparent',
              color: tab === 'url' ? 'var(--as-text)' : 'var(--as-text-muted)',
              fontWeight: tab === 'url' ? 600 : 450,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <Globe size={14} /> Web URL
          </button>
          <button
            type="button"
            onClick={() => setTab('upload')}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: tab === 'upload' ? 'var(--as-bg-surface)' : 'transparent',
              border: 'none',
              borderBottom: tab === 'upload' ? '2px solid var(--as-accent)' : '2px solid transparent',
              color: tab === 'upload' ? 'var(--as-text)' : 'var(--as-text-muted)',
              fontWeight: tab === 'upload' ? 600 : 450,
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <Upload size={14} /> Upload File
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: '18px' }}>
          {tab === 'url' ? (
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                Image Web Link (URL)
              </label>
              <input
                ref={urlInputRef}
                type="text"
                placeholder="https://images.unsplash.com/..."
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setPreviewError(false);
                }}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 'var(--as-radius-sm)',
                  border: '1px solid var(--as-border)',
                  backgroundColor: 'var(--as-bg)',
                  color: 'var(--as-text)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: '14px' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragActive ? 'var(--as-accent)' : 'var(--as-border-strong)'}`,
                  borderRadius: 'var(--as-radius-md)',
                  padding: '24px 16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  backgroundColor: dragActive ? 'var(--as-accent-subtle)' : 'var(--as-bg-subtle)',
                  transition: 'all var(--as-transition-fast)',
                }}
              >
                <Upload size={24} style={{ color: 'var(--as-accent)', marginBottom: '8px' }} />
                <div style={{ fontSize: '13px', fontWeight: 550 }}>
                  Click to browse or drop an image here
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--as-text-dim)', marginTop: '4px' }}>
                  PNG, JPG, GIF, WebP, SVG supported
                </div>
              </div>
            </div>
          )}

          {/* Alt text and title/caption */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                Alt Description
              </label>
              <input
                type="text"
                placeholder="Description of image"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 'var(--as-radius-sm)',
                  border: '1px solid var(--as-border)',
                  backgroundColor: 'var(--as-bg)',
                  color: 'var(--as-text)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                Caption (Optional)
              </label>
              <input
                type="text"
                placeholder="Figure title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 'var(--as-radius-sm)',
                  border: '1px solid var(--as-border)',
                  backgroundColor: 'var(--as-bg)',
                  color: 'var(--as-text)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Live Preview Thumbnail */}
          {url.trim() && (
            <div
              style={{
                marginBottom: '16px',
                padding: '8px',
                borderRadius: 'var(--as-radius-md)',
                backgroundColor: 'var(--as-bg-subtle)',
                border: '1px solid var(--as-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                maxHeight: '140px',
                overflow: 'hidden',
              }}
            >
              {!previewError ? (
                <img
                  src={url}
                  alt={alt || 'Preview'}
                  onError={() => setPreviewError(true)}
                  style={{
                    maxHeight: '130px',
                    maxWidth: '100%',
                    objectFit: 'contain',
                    borderRadius: 'var(--as-radius-sm)',
                  }}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: '#ef4444',
                    fontSize: '12px',
                    padding: '8px',
                  }}
                >
                  <AlertCircle size={15} /> Unable to load preview from this URL
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '7px 14px',
                borderRadius: 'var(--as-radius-sm)',
                border: '1px solid var(--as-border)',
                backgroundColor: 'transparent',
                color: 'var(--as-text)',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!url.trim()}
              style={{
                padding: '7px 16px',
                borderRadius: 'var(--as-radius-sm)',
                border: 'none',
                backgroundColor: url.trim() ? 'var(--as-accent)' : 'var(--as-border-strong)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '13px',
                cursor: url.trim() ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Check size={14} /> {initialUrl ? 'Update' : 'Insert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
