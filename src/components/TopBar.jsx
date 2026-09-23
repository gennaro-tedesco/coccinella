import { useEffect, useState } from "react";
import {
  Menu,
  ChevronRight,
  Table2,
  ChartNoAxesCombined,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { openCsvFile } from "../utils/openFile";
import { THEMES, THEME_ORDER } from "../utils/themes";
import { ICON_SIZE_MENU } from "../constants";
import logo from "../assets/logo.png";

const OPERATIONS = [
  { id: "merge", label: "Merge" },
  { id: "append", label: "Append" },
  { id: "aggregate", label: "Aggregate" },
  { id: "expression", label: "Expression" },
];

const SHORTCUTS = [
  ["Show shortcuts", "F1"],
  ["Open file finder", "Ctrl+p"],
  ["Go to sheet", "Ctrl+b"],
  ["Go to line", ":"],
  ["Dataset operations", "="],
  ["Toggle side panels", "z"],
  ["Go to tab", "Cmd+1-9"],
  ["Previous sheet", "Ctrl+^"],
  ["Scroll left", "h"],
  ["Scroll down", "j"],
  ["Scroll up", "k"],
  ["Scroll right", "l"],
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
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);
  const openSheet = useAppStore((state) => state.openSheet);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const canOperate = useAppStore((state) => state.sheetOrder.length >= 1);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const showError = useAppStore((state) => state.showError);
  const shortcutsMenuOpen = useAppStore((state) => state.shortcutsMenuOpen);
  const closeShortcutsMenu = useAppStore((state) => state.closeShortcutsMenu);

  useEffect(() => {
    if (!shortcutsMenuOpen) return;
    setMenuOpen(true);
    setOperationsSubmenuOpen(false);
    setThemeSubmenuOpen(false);
    setAboutSubmenuOpen(false);
    setShortcutsSubmenuOpen(true);
    closeShortcutsMenu();
  }, [shortcutsMenuOpen, closeShortcutsMenu]);

  async function handleOpen() {
    setMenuOpen(false);
    try {
      await openCsvFile(openSheet);
    } catch (error) {
      showError(error);
    }
  }

  return (
    <div className="top-bar" data-tauri-drag-region="deep">
      <div
        className="file-menu"
        onMouseLeave={() => {
          setMenuOpen(false);
          setOperationsSubmenuOpen(false);
          setThemeSubmenuOpen(false);
          setShortcutsSubmenuOpen(false);
          setAboutSubmenuOpen(false);
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
                disabled={!activeSheetId}
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
                setThemeSubmenuOpen(true);
                setOperationsSubmenuOpen(false);
                setShortcutsSubmenuOpen(false);
                setAboutSubmenuOpen(false);
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
                <ul className="file-menu-dropdown submenu">
                  {THEME_ORDER.map((key) => (
                    <li key={key}>
                      <button
                        type="button"
                        className={key === theme ? "active" : ""}
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
