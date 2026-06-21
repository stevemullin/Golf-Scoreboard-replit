export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "-";
  if (score === 0) return "E";
  if (score > 0) return `+${score}`;
  return `${score}`;
}

// ESPN tee times look like "Sun Jun 21 14:30:00 PDT 2026". Pull out the
// HH:MM and render a compact 12-hour time (e.g. "2:30p") for the THRU column.
export function formatTeeTime(raw: string | null | undefined): string {
  if (!raw) return "-";
  const m = raw.match(/(\d{1,2}):(\d{2})/);
  if (!m) return "-";
  let h = parseInt(m[1], 10);
  const min = m[2];
  const period = h >= 12 ? "p" : "a";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min}${period}`;
}
