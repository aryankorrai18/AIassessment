import { useRef, type KeyboardEvent } from "react";

/** Hand-built editor (no CodeMirror/Monaco): gutter + textarea, paste disabled. */
export function CodeEditor({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;

  // Tab inserts two spaces instead of leaving the editor.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.shiftKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = el;
    onChange(value.slice(0, s) + "  " + value.slice(end));
    requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
  };

  return (
    <div className="code-editor">
      <div className="code-topbar">
        <span className="code-lang"><span className="code-dot" aria-hidden="true" /> Code</span>
        <span className="hint">Paste is disabled — write your own solution</span>
      </div>
      <div className="code-body">
        <div className="code-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          className="code-input"
          aria-label="Your code"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => e.preventDefault()}
          onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
        />
      </div>
    </div>
  );
}
