<h1 align="center">
  <br>
  <img width="150" height="150" src="/src-tauri/app-icon.png">
  <br>
</h1>

<h4 align="center">the csv companion that gets out of the way</h4>
<h3 align="center">
  <a href="#Installation">Installation</a> •
  <a href="#Examples">Examples</a>
</h3>

`coccinella` is the `csv` companion that is always with you but that you never notice is there, because it gets out of the way: it does exactly what you expect it to do. The UI does what you want: it looks good, it feels good.

<img src="https://github.com/user-attachments/assets/cb1dbe3f-639b-4ca3-9b8a-f86d9905fbb5">

## Installation

Clone the repository and

```bash
npm run tauri build
```

## Features

Intuitive UI, blazingly fast, with built-in fuzzy finder and integrated plotting capabilities at your fingertips.

![demo](https://github.com/user-attachments/assets/f3bcc830-fa37-460e-ac12-8daca7d4e1c8)

## Examples

For a list of all shortcut keymaps mentioned below browse the hamburger menu (or press `F1`).

<details>
  <summary>Load and browse files</summary>

<br>
Data are lazy loaded so that even big files show with no delay. Columns data types are automatically inferred and can be manually changed using the columns settings; use the right panel to drag and drop columns around, select/unselect columns to show and see all columns and file stats on hover.<br><br>

Click columns to sort. Enter column selection model (`ctrl+` mouse click) to sort by multiple columns at the same time (in a nutshell, `ORDER BY COLUMN 1, COLUMN 2, ...`).

</details>

<details>
  <summary>Filter files</summary>

<br>

Filter files by row and condition by entering search (and filter mode). Upon search results are highlighted and can be scrolled through (shortcut `n` and `N`). Selecting "filter" (or shortcut `"`) creates a new sheet containing only the search results, which in turn appears as child sheet of the original one in the left panel (statistics are automatically recomputed in light of the new selections). Use column selection mode (`ctrl+` mouse click) to only search within the selected columns (rather than the entire file)

</details>

<details>
  <summary>Go to row</summary>

<br>

Go to row mode with `:<row number>`, selected row is highlighted and scrolled to the top.

</details>

<details>
  <summary>Data manipulation</summary>

<img src="https://github.com/user-attachments/assets/80ccb0f5-3522-410e-8e98-438169e31d3c">

Open the data manipulation menu with `=`. Merge, append and aggregate into pivot tables by selecting data, columns and functions.

</details>

## Plotting

For any loaded data set (and derived sheets) plotting is at your fingertips: switch to plotting mode and start exploring (or help yourself with the demo below).

![plotting](https://github.com/user-attachments/assets/10bfa5c7-50ed-471f-a5e9-e58e9e169384)
