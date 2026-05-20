export const UI_KIT_CSS = `
  .kg-shell {
    border: 1px solid var(--border, #2e3147);
    border-radius: 12px;
    background: var(--surface, #1a1d27);
    overflow: hidden;
  }

  .kg-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border, #2e3147);
  }

  .kg-tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .kg-tab {
    border: 1px solid var(--border, #2e3147);
    background: transparent;
    color: var(--text-muted, #94a3b8);
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 999px;
    cursor: pointer;
  }

  .kg-tab.active {
    border-color: var(--accent, #6366f1);
    color: #fff;
    background: color-mix(in srgb, var(--accent, #6366f1) 22%, transparent);
  }

  .kg-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 14px;
  }

  @media (max-width: 900px) {
    .kg-grid { grid-template-columns: 1fr; }
  }

  .kg-card {
    border: 1px solid var(--border, #2e3147);
    border-radius: 10px;
    background: color-mix(in srgb, var(--surface, #1a1d27) 70%, #080910);
    padding: 12px;
  }

  .kg-title {
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 10px;
    color: var(--text, #e2e8f0);
    letter-spacing: 0.2px;
  }

  .kg-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .kg-form .full { grid-column: 1 / -1; }

  .kg-label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 11px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--text-muted, #94a3b8);
  }

  .kg-input, .kg-select, .kg-textarea {
    width: 100%;
    border: 1px solid var(--border, #2e3147);
    background: var(--bg, #0f1117);
    color: var(--text, #e2e8f0);
    border-radius: 7px;
    padding: 8px 10px;
    font-size: 13px;
    outline: none;
  }

  .kg-textarea {
    min-height: 96px;
    resize: vertical;
    line-height: 1.35;
  }

  .kg-input:focus, .kg-select:focus, .kg-textarea:focus {
    border-color: var(--accent, #6366f1);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, #6366f1) 18%, transparent);
  }

  .kg-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .kg-btn {
    border: 1px solid var(--border, #2e3147);
    background: transparent;
    color: var(--text, #e2e8f0);
    border-radius: 7px;
    padding: 7px 11px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .kg-btn.primary {
    border-color: var(--accent, #6366f1);
    background: color-mix(in srgb, var(--accent, #6366f1) 28%, transparent);
  }

  .kg-btn.danger {
    border-color: #7f1d1d;
    color: #fecaca;
  }

  .kg-btn:hover {
    border-color: var(--accent, #6366f1);
  }

  .kg-list {
    max-height: 320px;
    overflow: auto;
    border: 1px solid var(--border, #2e3147);
    border-radius: 8px;
  }

  .kg-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: center;
    border-bottom: 1px solid color-mix(in srgb, var(--border, #2e3147) 60%, transparent);
    padding: 10px 12px;
    font-size: 12px;
  }

  .kg-row:last-child { border-bottom: 0; }

  .kg-meta {
    color: var(--text-muted, #94a3b8);
    font-size: 11px;
    margin-top: 2px;
  }

  .kg-status {
    padding: 6px 10px;
    border-top: 1px solid var(--border, #2e3147);
    font-size: 12px;
    color: var(--text-muted, #94a3b8);
    min-height: 30px;
  }

  .kg-status.error { color: #fca5a5; }
  .kg-status.ok { color: #86efac; }
`;
