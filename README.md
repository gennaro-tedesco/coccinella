<h1 align="center">
  <br>
  <img width="150" height="150" src="/src-tauri/app-icon.png">
  <br>
</h1>

<h4 align="center">the `csv` companion that gets out of the way</h4>
<h3 align="center">
  <a href="#Installation">Installation</a> •
  <a href="#Usage">Usage</a> •
</h3>

`coccinella` is the `csv` companion that is always with you but that you never notice is there, because it gets out of the way: it does exactly what you expect it to do. The UI does what you want: it looks good, it feels good.

<img alt="example_image" src="">

## Installation

TBD

## Features

Intuitive UI, blazingly fast, integrated plotting capabilities at your fingertips. Ah, and obviously vim keys (it goes without saying).

![demo](<>)

## Examples

<details>
  <summary>Load and browse files</summary>

<img width="400" src="">

Data are lazy loaded so that even big files show with no delay. Columns data types are automatically inferred and can be manually changed using the columns settings; use the right panel to drag and drop columns around, select/unselect columns to show and see all columns and file stats on hover.<br><br>

Click columns to sort. Enter column selection model (`ctrl+` mouse click) to sort by multiple columns at the same time (in a nutshell, `ORDER BY COLUMN 1, COLUMN 2, ...`).

</details>

<details>
  <summary>Filter files</summary>

Filter files by row and condition by entering search (and filter mode). Upon search results are highlighted and can be scrolled through (shortcut `n` and `N`). Selecting "filter" (or shortcut `"`) creates a new sheet containing only the search results, which in turn appears as child sheet of the original one in the left panel (statistics are automatically recomputed in light of the new selections). Use column selection mode (`ctrl+` mouse click) to only search within the selected columns (rather than the entire file)
<img width="400" src="">

</details>

<details>
  <summary>Go to row</summary>

Go to row mode with `:<row number>`, selected row is highlighted and scrolled to the top.

</details>
