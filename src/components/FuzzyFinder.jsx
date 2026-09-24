import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";
import { FUZZY_SEARCH_DEBOUNCE_MS } from "../constants";

function splitDirAndBase(label) {
  const slashIndex = label.lastIndexOf("/");
  if (slashIndex === -1) return { dir: "", base: label };
  return { dir: label.slice(0, slashIndex), base: label.slice(slashIndex + 1) };
}

function renderHighlighted(text, offset, indices) {
  if (!indices || indices.length === 0) return text;
  const matched = new Set();
  for (const index of indices) {
    const relative = index - offset;
    if (relative >= 0 && relative < text.length) matched.add(relative);
  }
  if (matched.size === 0) return text;
  const nodes = [];
  let run = "";
  let runMatched = false;
  for (let i = 0; i < text.length; i += 1) {
    const isMatch = matched.has(i);
    if (i > 0 && isMatch !== runMatched) {
      nodes.push(
        runMatched ? (
          <span className="fuzzy-finder-match" key={nodes.length}>
            {run}
          </span>
        ) : (
          run
        ),
      );
      run = "";
    }
    run += text[i];
    runMatched = isMatch;
  }
  if (run) {
    nodes.push(
      runMatched ? (
        <span className="fuzzy-finder-match" key={nodes.length}>
          {run}
        </span>
      ) : (
        run
      ),
    );
  }
  return nodes;
}

function FuzzyFinder({ placeholder, items, getLabel, getGroup, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [matches, setMatches] = useState(items);
  const [indicesByLabel, setIndicesByLabel] = useState(new Map());
  const inputRef = useRef(null);
  const activeItemRef = useRef(null);
  const keyboardNavigationRef = useRef(false);
  const showError = useAppStore((state) => state.showError);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query) {
      setMatches(items);
      setIndicesByLabel(new Map());
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      const labels = items.map(getLabel);
      invoke("fuzzy_filter", { query, candidates: labels })
        .then((results) => {
          if (cancelled) return;
          const pool = new Map();
          for (const item of items) {
            const label = getLabel(item);
            if (!pool.has(label)) pool.set(label, []);
            pool.get(label).push(item);
          }
          const nextIndices = new Map();
          const nextMatches = [];
          for (const result of results) {
            const item = pool.get(result.text)?.shift();
            if (item === undefined) continue;
            nextMatches.push(item);
            nextIndices.set(result.text, result.indices);
          }
          setMatches(nextMatches);
          setIndicesByLabel(nextIndices);
        })
        .catch((error) => {
          if (!cancelled) {
            setMatches([]);
            setIndicesByLabel(new Map());
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

  useEffect(() => {
    if (!keyboardNavigationRef.current) return;
    keyboardNavigationRef.current = false;
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const groups = useMemo(() => {
    if (!getGroup) return null;
    const byGroup = new Map();
    const ordered = [];
    matches.forEach((item, index) => {
      const key = getGroup(item);
      if (!byGroup.has(key)) {
        const group = { key, entries: [], dirIndices: new Set() };
        byGroup.set(key, group);
        ordered.push(group);
      }
      const group = byGroup.get(key);
      group.entries.push({ item, index });
      const indices = indicesByLabel.get(getLabel(item));
      if (indices) {
        for (const matchIndex of indices) {
          if (matchIndex < key.length) group.dirIndices.add(matchIndex);
        }
      }
    });
    return ordered;
  }, [matches, getGroup, getLabel, indicesByLabel]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = Math.min(activeIndex + 1, matches.length - 1);
      keyboardNavigationRef.current = nextIndex !== activeIndex;
      setActiveIndex(nextIndex);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = Math.max(activeIndex - 1, 0);
      keyboardNavigationRef.current = nextIndex !== activeIndex;
      setActiveIndex(nextIndex);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (matches[activeIndex]) onSelect(matches[activeIndex]);
    }
  }

  function renderItem(item, index, labelOverride) {
    const label = getLabel(item);
    const indices = indicesByLabel.get(label);
    const offset = labelOverride ? label.length - labelOverride.length : 0;
    const displayText = labelOverride ?? label;
    return (
      <button
        ref={index === activeIndex ? activeItemRef : null}
        type="button"
        className={"fuzzy-finder-item" + (index === activeIndex ? " active" : "")}
        onMouseEnter={() => {
          keyboardNavigationRef.current = false;
          setActiveIndex(index);
        }}
        onClick={() => onSelect(item)}
      >
        {renderHighlighted(displayText, offset, indices)}
      </button>
    );
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
          {groups
            ? groups.map((group) => (
                <li key={group.key || "/"} className="fuzzy-finder-group">
                  <div className="fuzzy-finder-group-label">
                    {renderHighlighted(group.key || "~", 0, Array.from(group.dirIndices))}
                  </div>
                  <ul className="fuzzy-finder-children">
                    {group.entries.map(({ item, index }) => (
                      <li key={item.id ?? index}>
                        <div className="fuzzy-finder-leaf">
                          <span className="fuzzy-finder-branch" aria-hidden="true" />
                          {renderItem(item, index, splitDirAndBase(getLabel(item)).base)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))
            : matches.map((item, index) => (
                <li key={item.id ?? index}>{renderItem(item, index)}</li>
              ))}
        </ul>
      </div>
    </div>
  );
}

export default FuzzyFinder;
