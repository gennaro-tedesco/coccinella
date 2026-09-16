// Color values sourced from material.nvim (marko-cerovac/material.nvim),
// lua/material/colors/init.lua — the "main" hues and per-style "editor" colors.
const DEFAULT_MAIN_COLORS = [
  "#F07178", // red
  "#C3E88D", // green
  "#FFCB6B", // yellow
  "#82AAFF", // blue
  "#B0C9FF", // paleblue
  "#89DDFF", // cyan
  "#C792EA", // purple
  "#F78C6C", // orange
];

export const THEMES = {
  oceanic: {
    label: "Oceanic",
    bg: "#25363B",
    bgAlt: "#1C2C30",
    fg: "#B0BEC5",
    fgDark: "#7C9EAD",
    border: "#355058",
    active: "#314549",
    highlight: "#354A51",
    disabled: "#3E5F64",
    accent: "#11BBA3",
    colors: DEFAULT_MAIN_COLORS,
  },
  deepOcean: {
    label: "Deep Ocean",
    bg: "#0F111A",
    bgAlt: "#090B10",
    fg: "#A6ACCD",
    fgDark: "#717CB4",
    border: "#232637",
    active: "#1A1C25",
    highlight: "#1F2233",
    disabled: "#464B5D",
    accent: "#84FFFF",
    colors: DEFAULT_MAIN_COLORS,
  },
  palenight: {
    label: "Palenight",
    bg: "#292D3E",
    bgAlt: "#1B1E2B",
    fg: "#A6ACCD",
    fgDark: "#717CB4",
    border: "#364367",
    active: "#414863",
    highlight: "#444267",
    disabled: "#515772",
    accent: "#AB47BC",
    colors: DEFAULT_MAIN_COLORS,
  },
  darker: {
    label: "Darker",
    bg: "#212121",
    bgAlt: "#1A1A1A",
    fg: "#B0BEC5",
    fgDark: "#8C8B8B",
    border: "#343434",
    active: "#323232",
    highlight: "#3F3F3F",
    disabled: "#474747",
    accent: "#FF9800",
    colors: DEFAULT_MAIN_COLORS,
  },
  lighter: {
    label: "Lighter",
    bg: "#FAFAFA",
    bgAlt: "#FFFFFF",
    fg: "#546E7A",
    fgDark: "#94A7B0",
    border: "#D3E1E8",
    active: "#E7E7E8",
    highlight: "#E7E7E8",
    disabled: "#D2D4D5",
    accent: "#00BCD4",
    colors: [
      "#E53935", // red
      "#91B859", // green
      "#F6A434", // yellow
      "#6182B8", // blue
      "#8796B0", // paleblue
      "#39ADB5", // cyan
      "#7C4DFF", // purple
      "#F76D47", // orange
    ],
  },
};

export const THEME_ORDER = ["oceanic", "deepOcean", "palenight", "darker", "lighter"];
