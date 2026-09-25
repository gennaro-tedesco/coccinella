// Color values sourced from material.nvim and ray-x/starry.nvim.
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
  dracula: {
    label: "Dracula",
    bg: "#21222C",
    bgAlt: "#282A36",
    fg: "#F4F3F2",
    fgDark: "#6476A6",
    border: "#5144A3",
    active: "#363B40",
    highlight: "#716F90",
    disabled: "#615752",
    accent: "#A34C81",
    colors: [
      "#FF555F",
      "#50FA7B",
      "#F1FA87",
      "#04D1F9",
      "#8697B0",
      "#8BE4F1",
      "#BD94F4",
      "#FF79C1",
    ],
  },
  monokai: {
    label: "Monokai",
    bg: "#262721",
    bgAlt: "#30312A",
    fg: "#CED1D4",
    fgDark: "#75715E",
    border: "#414245",
    active: "#3E383A",
    highlight: "#515B70",
    disabled: "#4F5466",
    accent: "#66D9EF",
    colors: [
      "#E73C50",
      "#A6E22D",
      "#E6DB74",
      "#5594EC",
      "#A6A7D0",
      "#A1EFE4",
      "#AE81FF",
      "#FD9720",
    ],
  },
  darkSolar: {
    label: "Sol Dark",
    bg: "#00141A",
    bgAlt: "#002D38",
    fg: "#9FABAD",
    fgDark: "#586E74",
    border: "#073541",
    active: "#002D38",
    highlight: "#073541",
    disabled: "#647A82",
    accent: "#B28600",
    colors: [
      "#DC312E",
      "#859900",
      "#B28600",
      "#278BD3",
      "#6D72C5",
      "#2AA298",
      "#D33682",
      "#CA4C16",
    ],
  },
  lightSolar: {
    label: "Sol Light",
    bg: "#FDF6E2",
    bgAlt: "#EDE7D4",
    fg: "#647A82",
    fgDark: "#ADB8B8",
    border: "#EDE7D4",
    active: "#EDE7D4",
    highlight: "#EDE7D4",
    disabled: "#9FABAD",
    accent: "#B28600",
    colors: [
      "#DC312E",
      "#859900",
      "#B28600",
      "#278BD3",
      "#6D72C5",
      "#2AA298",
      "#D33682",
      "#CA4C16",
    ],
  },
};

export const THEME_ORDER = [
  "darkSolar",
  "lightSolar",
  "oceanic",
  "palenight",
  "lighter",
  "dracula",
  "monokai",
];
