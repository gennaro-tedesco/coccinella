import { useEffect, useRef, useState } from "react";
import { parseRowSelectionRange } from "../utils/rowRange";

function SliceRows({ maxRow, range, onClose, onSlice }) {
  const [value, setValue] = useState(`${range.start + 1}-${range.end + 1}`);
  const formRef = useRef(null);
  const inputRef = useRef(null);
  const parsedRange = parseRowSelectionRange(value, maxRow);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setValue(`${range.start + 1}-${range.end + 1}`);
  }, [range.start, range.end]);

  return (
    <form
      ref={formRef}
      className="go-to-line slice-rows"
      role="dialog"
      aria-labelledby="slice-rows-label"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsedRange) onSlice(parsedRange.start, parsedRange.end);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === '"') {
          event.preventDefault();
          formRef.current?.requestSubmit();
        }
      }}
    >
      <label id="slice-rows-label" htmlFor="slice-rows-input">
        Slice
      </label>
      <input
        ref={inputRef}
        id="slice-rows-input"
        type="text"
        inputMode="numeric"
        required
        value={value}
        placeholder={`1-${maxRow}`}
        aria-label={`Row range, 1 through ${maxRow}`}
        aria-invalid={!parsedRange}
        onChange={(event) => setValue(event.target.value)}
      />
    </form>
  );
}

export default SliceRows;
