import { useEffect, useMemo, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { buildMatcher, findMatches } from "../utils/search";

function SearchPanel() {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const query = useAppStore((state) => state.searchQuery);
  const isRegex = useAppStore((state) => state.searchIsRegex);
  const isCaseSensitive = useAppStore((state) => state.searchIsCaseSensitive);
  const activeIndex = useAppStore((state) => state.searchActiveIndex);
  const setQuery = useAppStore((state) => state.setSearchQuery);
  const setIsRegex = useAppStore((state) => state.setSearchIsRegex);
  const setIsCaseSensitive = useAppStore(
    (state) => state.setSearchIsCaseSensitive,
  );
  const setActiveIndex = useAppStore((state) => state.setSearchActiveIndex);
  const closeSearch = useAppStore((state) => state.closeSearch);
  const createFilteredSheet = useAppStore(
    (state) => state.createFilteredSheet,
  );
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matcher = useMemo(
    () => buildMatcher(query, isRegex, isCaseSensitive),
    [query, isRegex, isCaseSensitive],
  );
  const matches = useMemo(
    () => (sheet && matcher ? findMatches(sheet.rows, sheet.columns, matcher) : []),
    [sheet, matcher],
  );
  const matchCount = matches.length;
  const clampedIndex = matchCount ? activeIndex % matchCount : 0;

  function step(direction) {
    if (!matchCount) return;
    setActiveIndex((clampedIndex + direction + matchCount) % matchCount);
  }

  const canFilter = matchCount > 0 && !sheet?.filterOf;

  return (
    <div
      className="search-panel"
      role="dialog"
      aria-label="Search"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setQuery("");
          closeSearch();
        } else if (event.key === "Enter") {
          event.preventDefault();
          closeSearch();
        }
      }}
    >
      <input
        ref={inputRef}
        type="text"
        className="search-panel-input"
        placeholder="Search..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
      />
      <label className="search-panel-option">
        <input
          type="checkbox"
          checked={isRegex}
          onChange={(event) => setIsRegex(event.target.checked)}
        />
        Regex
      </label>
      <label className="search-panel-option">
        <input
          type="checkbox"
          checked={isCaseSensitive}
          onChange={(event) => setIsCaseSensitive(event.target.checked)}
        />
        Case sensitive
      </label>
      <span className="search-panel-count">
        {matchCount ? `${clampedIndex + 1} / ${matchCount}` : "0 / 0"}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        disabled={!matchCount}
        onClick={() => step(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="Next match"
        disabled={!matchCount}
        onClick={() => step(1)}
      >
        ↓
      </button>
      <button
        type="button"
        className="search-panel-filter"
        disabled={!canFilter}
        title={
          sheet?.filterOf
            ? "Already viewing a filtered sheet"
            : "Filter to matching rows"
        }
        onClick={() => {
          createFilteredSheet(activeSheetId, query, isRegex, isCaseSensitive);
          closeSearch();
        }}
      >
        Filter
      </button>
      <button type="button" aria-label="Close search" onClick={closeSearch}>
        ✕
      </button>
    </div>
  );
}

export default SearchPanel;
