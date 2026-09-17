import { useEffect, useRef, useState } from "react";

function GoToLine({ maxLine, onClose, onGoToLine }) {
  const [line, setLine] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      className="go-to-line"
      role="dialog"
      aria-labelledby="go-to-line-label"
      onSubmit={(event) => {
        event.preventDefault();
        const lineNumber = Number(line);
        if (!Number.isInteger(lineNumber)) return;
        onGoToLine(lineNumber);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <label id="go-to-line-label" htmlFor="go-to-line-input">
        Go to line
      </label>
      <input
        ref={inputRef}
        id="go-to-line-input"
        type="number"
        min="1"
        max={maxLine}
        step="1"
        required
        value={line}
        placeholder={`1-${maxLine}`}
        aria-label={`Line number, 1 through ${maxLine}`}
        onChange={(event) => setLine(event.target.value)}
      />
    </form>
  );
}

export default GoToLine;
