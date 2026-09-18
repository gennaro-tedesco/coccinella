import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";
import { FUZZY_SEARCH_DEBOUNCE_MS } from "../constants";

function FuzzyFinder({ placeholder, items, getLabel, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [matches, setMatches] = useState(items);
  const inputRef = useRef(null);
  const showError = useAppStore((state) => state.showError);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query) {
      setMatches(items);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      const labels = items.map(getLabel);
      invoke("fuzzy_filter", { query, candidates: labels })
        .then((matchedLabels) => {
          if (cancelled) return;
          const pool = new Map();
          for (const item of items) {
            const label = getLabel(item);
            if (!pool.has(label)) pool.set(label, []);
            pool.get(label).push(item);
          }
          setMatches(
            matchedLabels
              .map((label) => pool.get(label)?.shift())
              .filter((item) => item !== undefined),
          );
        })
        .catch((error) => {
          if (!cancelled) {
            setMatches([]);
            showError(error);
          }
        });
    }, FUZZY_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [items, query, getLabel, showError]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (matches[activeIndex]) onSelect(matches[activeIndex]);
    }
  }

  return (
    <div className="fuzzy-finder-overlay" onMouseDown={onClose}>
      <div className="fuzzy-finder" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className="fuzzy-finder-input"
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        <ul className="fuzzy-finder-list">
          {matches.length === 0 && (
            <li className="fuzzy-finder-empty">No matches</li>
          )}
          {matches.map((item, index) => (
            <li key={item.id ?? index}>
              <button
                type="button"
                className={
                  "fuzzy-finder-item" + (index === activeIndex ? " active" : "")
                }
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(item)}
              >
                {getLabel(item)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default FuzzyFinder;
