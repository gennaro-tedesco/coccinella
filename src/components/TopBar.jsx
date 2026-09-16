import { useState } from "react";
import { Menu, ChevronRight } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";
import { parseCsv } from "../utils/csv";
import { THEMES, THEME_ORDER } from "../utils/themes";

function TopBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [themeSubmenuOpen, setThemeSubmenuOpen] = useState(false);
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);
  const openSheet = useAppStore((state) => state.openSheet);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);

  async function handleOpen() {
    setMenuOpen(false);
    const path = await open({
      multiple: false,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;

    const text = await invoke("read_csv_file", { path });
    const { columns, rows } = parseCsv(text);
    const filename = path.split(/[\\/]/).pop();
    const sizeBytes = new TextEncoder().encode(text).length;
    openSheet(filename, columns, rows, sizeBytes);
  }

  return (
    <div className="top-bar">
      <div className="file-menu">
        <button
          type="button"
          className="file-menu-trigger"
          aria-label="Menu"
          onClick={() => {
            setMenuOpen((open) => !open);
            setThemeSubmenuOpen(false);
          }}
        >
          <Menu size={18} />
        </button>
        {menuOpen && (
          <ul className="file-menu-dropdown">
            <li>
              <button type="button" onClick={handleOpen}>
                Open
              </button>
            </li>
            <li>
              <button type="button" disabled>
                Browse
              </button>
            </li>
            <li>
              <button type="button" disabled>
                Search
              </button>
            </li>
            <li className="menu-separator" />
            <li
              className="has-submenu"
              onMouseEnter={() => setThemeSubmenuOpen(true)}
              onMouseLeave={() => setThemeSubmenuOpen(false)}
            >
              <button
                type="button"
                onClick={() => setThemeSubmenuOpen((open) => !open)}
              >
                <span>Theme</span>
                <ChevronRight size={14} />
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
          </ul>
        )}
      </div>

      <div className="mode-toggle">
        <button
          type="button"
          className={mode === "data" ? "active" : ""}
          onClick={() => setMode("data")}
        >
          Data
        </button>
        <button
          type="button"
          className={mode === "plot" ? "active" : ""}
          onClick={() => setMode("plot")}
        >
          Plot
        </button>
      </div>
    </div>
  );
}

export default TopBar;
