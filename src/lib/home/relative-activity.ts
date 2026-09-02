/**
 * Formats an activity timestamp relative to one caller-supplied reference
 * time. Keeping both values explicit makes server and hydrated output agree.
 */
export function relativeActivityLabel(value: string, nowValue: string): string {
  const elapsed = Math.max(0, Date.parse(nowValue) - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
