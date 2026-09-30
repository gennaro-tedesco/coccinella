import { useEffect, useState } from "react";
import {
  Menu,
  ChevronRight,
  Table2,
  ChartNoAxesCombined,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { openFile } from "../utils/openFile";
import { THEMES, THEME_ORDER } from "../utils/themes";
import { ICON_SIZE_MENU } from "../constants";
import logo from "../assets/logo.png";

const OPERATIONS = [
  { id: "merge", label: "Merge" },
  { id: "append", label: "Append" },
  { id: "aggregate", label: "Aggregate" },
  { id: "expression", label: "Expression" },
];

const FUZZY_FIND_ITEM_LIMITS = [1000, 5000, 10000];

const SHORTCUTS = [
  ["Show shortcuts", "F1"],
  ["Open file finder", "Ctrl+p"],
  ["Go to sheet", "Ctrl+b"],
  ["Go to line", ":"],
  ["Search", "/ / Ctrl+f"],
  ["Next / previous match", "n / N"],
  ["Filter from search", "\""],
  ["Slice selected rows", "\""],
  ["Clear search", "Esc"],
  ["Dataset operations", "="],
  ["Toggle row indexes", "i"],
  ["Toggle side panels", "z"],
  ["Toggle data / plot view", "Tab"],
  ["Close sheet", "qq"],
  ["Previous / next plot type", "k / j / ↑ / ↓"],
  ["Go to tab", "Cmd+1-9"],
  ["Previous sheet", "Ctrl+^"],
  ["Scroll left", "h / ←"],
  ["Scroll down", "j"],
  ["Scroll up", "k"],
  ["Scroll right", "l / →"],
  ["Go to top", "gg"],
  ["Go to bottom", "G"],
  ["Half page up", "Ctrl+u"],
  ["Half page down", "Ctrl+d"],
  ["Increase font", "Shift++ / Ctrl++"],
  ["Decrease font", "Shift+- / Ctrl+-"],
  ["Toggle column selection", "Ctrl+click"],
];

function TopBar({ onOpenSearch, onOpenGoTo, onOpenMerge }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [operationsSubmenuOpen, setOperationsSubmenuOpen] = useState(false);
  const [themeSubmenuOpen, setThemeSubmenuOpen] = useState(false);
  const [shortcutsSubmenuOpen, setShortcutsSubmenuOpen] = useState(false);
  const [aboutSubmenuOpen, setAboutSubmenuOpen] = useState(false);
  const [settingsSubmenuOpen, setSettingsSubmenuOpen] = useState(false);
  const [fuzzyLimitSubmenuOpen, setFuzzyLimitSubmenuOpen] = useState(false);
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);
  const openSheet = useAppStore((state) => state.openSheet);
  const openJson = useAppStore((state) => state.openJson);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const activeFile = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const canOperate = Boolean(activeFile && activeFile.kind !== "json");
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const setPreviewTheme = useAppStore((state) => state.setPreviewTheme);
  const showError = useAppStore((state) => state.showError);
  const shortcutsMenuOpen = useAppStore((state) => state.shortcutsMenuOpen);
  const closeShortcutsMenu = useAppStore((state) => state.closeShortcutsMenu);
  const fuzzyFindItemLimit = useAppStore((state) => state.fuzzyFindItemLimit);
  const setFuzzyFindItemLimit = useAppStore((state) => state.setFuzzyFindItemLimit);
  const copyWithQuotes = useAppStore((state) => state.copyWithQuotes);
  const setCopyWithQuotes = useAppStore((state) => state.setCopyWithQuotes);
  const showRowIndex = useAppStore((state) => state.showRowIndex);
  const setShowRowIndex = useAppStore((state) => state.setShowRowIndex);

  useEffect(() => {
    if (!shortcutsMenuOpen) return;
    setMenuOpen(true);
    setOperationsSubmenuOpen(false);
    setThemeSubmenuOpen(false);
    setAboutSubmenuOpen(false);
    setSettingsSubmenuOpen(false);
    setFuzzyLimitSubmenuOpen(false);
    setShortcutsSubmenuOpen(true);
    closeShortcutsMenu();
  }, [shortcutsMenuOpen, closeShortcutsMenu]);

  useEffect(() => {
    if (!themeSubmenuOpen) setPreviewTheme(null);
  }, [themeSubmenuOpen, setPreviewTheme]);

  async function handleOpen() {
    setMenuOpen(false);
    try {
      await openFile(openSheet, openJson);
    } catch (error) {
      showError(error);
    }
  }

  return (
    <div className="top-bar" data-tauri-drag-region="deep">
      <div
        className="file-menu"
        onMouseEnter={() => setMenuOpen(true)}
        onMouseLeave={() => {
          setMenuOpen(false);
          setOperationsSubmenuOpen(false);
          setThemeSubmenuOpen(false);
          setShortcutsSubmenuOpen(false);
          setAboutSubmenuOpen(false);
          setSettingsSubmenuOpen(false);
          setFuzzyLimitSubmenuOpen(false);
        }}
      >
        <button
          type="button"
          className={`file-menu-trigger${menuOpen ? " open" : ""}`}
          aria-label="Menu"
          onClick={() => {
            setMenuOpen((open) => !open);
            setOperationsSubmenuOpen(false);
            setThemeSubmenuOpen(false);
            setShortcutsSubmenuOpen(false);
            setAboutSubmenuOpen(false);
            setSettingsSubmenuOpen(false);
            setFuzzyLimitSubmenuOpen(false);
          }}
        >
          <Menu />
        </button>
        {menuOpen && (
          <ul className="file-menu-dropdown">
            <li>
              <button type="button" onClick={handleOpen}>
                Open
              </button>
            </li>
            <li>
              <button
                type="button"
                disabled={!activeSheetId}
                onClick={() => {
                  setMenuOpen(false);
                  setMode("data");
                  onOpenSearch();
                }}
              >
                Search
              </button>
            </li>
            <li>
              <button
                type="button"
                disabled={!activeSheetId || activeFile?.kind === "json"}
                onClick={() => {
                  setMenuOpen(false);
                  setMode("data");
                  onOpenGoTo();
                }}
              >
                Go to
              </button>
            </li>
            <li
              className="has-submenu"
              onMouseEnter={() => {
                setOperationsSubmenuOpen(true);
                setThemeSubmenuOpen(false);
                setShortcutsSubmenuOpen(false);
                setAboutSubmenuOpen(false);
                setSettingsSubmenuOpen(false);
              }}
              onMouseLeave={() => setOperationsSubmenuOpen(false)}
            >
              <button
                type="button"
                disabled={!canOperate}
                onClick={() => setOperationsSubmenuOpen((open) => !open)}
              >
                <span>Operations</span>
                <ChevronRight size={ICON_SIZE_MENU} />
              </button>
              {operationsSubmenuOpen && (
                <ul className="file-menu-dropdown submenu">
                  {OPERATIONS.map(({ id, label }) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setOperationsSubmenuOpen(false);
                          setMode("data");
                          onOpenMerge(id);
                        }}
                      >
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
            <li className="menu-separator" />
            <li
              className="has-submenu"
              onMouseEnter={() => {
                setSettingsSubmenuOpen(true);
                setOperationsSubmenuOpen(false);
                setThemeSubmenuOpen(false);
                setShortcutsSubmenuOpen(false);
                setAboutSubmenuOpen(false);
              }}
              onMouseLeave={() => {
                setSettingsSubmenuOpen(false);
                setFuzzyLimitSubmenuOpen(false);
              }}
            >
              <button
                type="button"
                onClick={() => setSettingsSubmenuOpen((open) => !open)}
              >
                <span>Settings</span>
                <ChevronRight size={ICON_SIZE_MENU} />
              </button>
              {settingsSubmenuOpen && (
                <ul className="file-menu-dropdown submenu settings-submenu">
                  <li
                    className="has-submenu"
                    onMouseEnter={() => setFuzzyLimitSubmenuOpen(true)}
                    onMouseLeave={() => setFuzzyLimitSubmenuOpen(false)}
                  >
                    <button
                      type="button"
                      onClick={() => setFuzzyLimitSubmenuOpen((open) => !open)}
                    >
                      <span>Fuzzy file limit</span>
                      <span className="settings-menu-value">
                        {fuzzyFindItemLimit}
                        <ChevronRight size={ICON_SIZE_MENU} />
                      </span>
                    </button>
                    {fuzzyLimitSubmenuOpen && (
                      <ul className="file-menu-dropdown submenu">
                        {FUZZY_FIND_ITEM_LIMITS.map((limit) => (
                          <li key={limit}>
                            <button
                              type="button"
                              className={limit === fuzzyFindItemLimit ? "active" : ""}
                              onClick={() => {
                                setFuzzyFindItemLimit(limit);
                                setMenuOpen(false);
                                setSettingsSubmenuOpen(false);
                                setFuzzyLimitSubmenuOpen(false);
                              }}
                            >
                              {limit}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                  <li>
                    <label className="settings-menu-checkbox">
                      <span>Copy with quotes</span>
                      <input
                        type="checkbox"
                        checked={copyWithQuotes}
                        onChange={(event) => setCopyWithQuotes(event.target.checked)}
                      />
                    </label>
                  </li>
                  <li>
                    <label className="settings-menu-checkbox">
                      <span>Show row index</span>
                      <input
                        type="checkbox"
                        checked={showRowIndex}
                        onChange={(event) => setShowRowIndex(event.target.checked)}
                      />
                    </label>
                  </li>
                </ul>
              )}
            </li>
            <li
              className="has-submenu"
              onMouseEnter={() => {
                setThemeSubmenuOpen(true);
                setOperationsSubmenuOpen(false);
                setShortcutsSubmenuOpen(false);
                setAboutSubmenuOpen(false);
                setSettingsSubmenuOpen(false);
              }}
              onMouseLeave={() => setThemeSubmenuOpen(false)}
            >
              <button
                type="button"
                onClick={() => setThemeSubmenuOpen((open) => !open)}
              >
                <span>Theme</span>
                <ChevronRight size={ICON_SIZE_MENU} />
              </button>
              {themeSubmenuOpen && (
                <ul
                  className="file-menu-dropdown submenu"
                  onMouseLeave={() => setPreviewTheme(null)}
                >
                  {THEME_ORDER.map((key) => (
                    <li key={key}>
                      <button
                        type="button"
                        className={key === theme ? "active" : ""}
                        onMouseEnter={() => setPreviewTheme(key)}
                        onClick={() => {
                          setTheme(key);
                          setMenuOpen(false);
                          setThemeSubmenuOpen(false);
                        }}
                      >
                        {THEMES[key].label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
            <li
              className="has-submenu"
              onMouseEnter={() => {
                setShortcutsSubmenuOpen(true);
                setOperationsSubmenuOpen(false);
                setThemeSubmenuOpen(false);
                setAboutSubmenuOpen(false);
                setSettingsSubmenuOpen(false);
              }}
              onMouseLeave={() => setShortcutsSubmenuOpen(false)}
            >
              <button
                type="button"
                onClick={() =>
                  setShortcutsSubmenuOpen((open) => !open)
                }
              >
                <span>Shortcuts</span>
                <ChevronRight size={ICON_SIZE_MENU} />
              </button>
              {shortcutsSubmenuOpen && (
                <ul className="file-menu-dropdown submenu shortcuts-submenu">
                  {SHORTCUTS.map(([label, keys]) => (
                    <li className="shortcut-item" key={label}>
                      <span>{label}</span>
                      <kbd>{keys}</kbd>
                    </li>
                  ))}
                </ul>
              )}
            </li>
            <li className="menu-separator" />
            <li
              className="has-submenu"
              onMouseEnter={() => {
                setAboutSubmenuOpen(true);
                setOperationsSubmenuOpen(false);
                setThemeSubmenuOpen(false);
                setShortcutsSubmenuOpen(false);
                setSettingsSubmenuOpen(false);
              }}
              onMouseLeave={() => setAboutSubmenuOpen(false)}
            >
              <button
                type="button"
                onClick={() => setAboutSubmenuOpen((open) => !open)}
              >
                <span>About</span>
                <ChevronRight size={ICON_SIZE_MENU} />
              </button>
              {aboutSubmenuOpen && (
                <ul className="file-menu-dropdown submenu">
                  <li className="about-item">
                    <img src={logo} alt="coccinella" />
                    <span>
                      Version {import.meta.env.VITE_BUILD_VERSION}
                    </span>
                  </li>
                </ul>
              )}
            </li>
          </ul>
        )}
      </div>

      <div className="mode-toggle">
        <button
          type="button"
          className={mode === "data" ? "active" : ""}
          aria-label="Data view"
          aria-pressed={mode === "data"}
          title="Data view"
          onClick={() => setMode("data")}
        >
          <Table2 />
        </button>
        <button
          type="button"
          className={mode === "plot" ? "active" : ""}
          disabled={activeFile?.kind === "json"}
          aria-label="Plot view"
          aria-pressed={mode === "plot"}
          title="Plot view"
          onClick={() => setMode("plot")}
        >
          <ChartNoAxesCombined />
        </button>
      </div>
    </div>
  );
}

export default TopBar;
