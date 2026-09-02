export type CollectionIconName = "favorite" | "cart";

export function CollectionIcon({ name, active = false, className = "h-4 w-4" }: {
  name: CollectionIconName;
  active?: boolean;
  className?: string;
}) {
  if (name === "favorite") {
    return (
      <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h2l2.1 10.1a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20.5 7H6" />
      <circle cx="9.5" cy="19" r="1.25" />
      <circle cx="17" cy="19" r="1.25" />
      {active && <path d="m10 10 1.6 1.6L15 8.4" strokeWidth="2.2" />}
    </svg>
  );
}
