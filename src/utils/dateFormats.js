const UNIX_SECONDS_DIGITS = 10;
const MILLISECONDS_PER_SECOND = 1000;

function parseDateValue(value) {
  const text = String(value).trim();
  if (/^-?\d+$/.test(text)) {
    const timestamp = Number(text);
    const milliseconds = text.replace("-", "").length > UNIX_SECONDS_DIGITS
      ? timestamp
      : timestamp * MILLISECONDS_PER_SECOND;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dayFirst = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.getUTCFullYear() === Number(year)
      && date.getUTCMonth() === Number(month) - 1
      && date.getUTCDate() === Number(day)
      ? date
      : null;
  }

  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (value, length = 2) => String(value).padStart(length, "0");

export function formatDateValue(value, format) {
  if (format === "auto") return value;
  const date = parseDateValue(value);
  if (!date) return value;

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  if (format === "unix") {
    return String(Math.floor(date.getTime() / MILLISECONDS_PER_SECOND));
  }
  if (format === "dmy") return `${day}/${month}/${year}`;

  const calendarDate = `${year}-${month}-${day}`;
  if (format === "ymd") return calendarDate;
  if (format === "timestamp") {
    const hours = pad(date.getUTCHours());
    const minutes = pad(date.getUTCMinutes());
    const seconds = pad(date.getUTCSeconds());
    const milliseconds = pad(date.getUTCMilliseconds(), 3);
    return `${calendarDate} ${hours}:${minutes}:${seconds}.${milliseconds}`;
  }
  return value;
}
