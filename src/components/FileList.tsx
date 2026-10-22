"use client";

import { useMemo, useState } from "react";

type Props = {
  files: string[];
  selectedFile: string | null;
  onSelect: (file: string) => void;
  lineCounts?: Record<string, number>;
};

export function FileList({ files, selectedFile, onSelect, lineCounts }: Props) {
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.toLowerCase().includes(q));
  }, [files, filter]);

  return (
    <div className="file-list-panel">
      <div className="file-list-header">
        <span className="file-list-title">文件</span>
        <input
          className="file-filter"
          placeholder="过滤…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <ul className="file-list">
        {visible.map((file) => {
          const count = lineCounts?.[file];
          const active = file === selectedFile;
          return (
            <li key={file}>
              <button
                type="button"
                className={`file-item${active ? " active" : ""}`}
                onClick={() => onSelect(file)}
                title={file}
              >
                <span className="file-name">{file}</span>
                {typeof count === "number" && (
                  <span className="file-count muted">{count}</span>
                )}
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="muted file-empty">无匹配文件</li>
        )}
      </ul>
    </div>
  );
}
