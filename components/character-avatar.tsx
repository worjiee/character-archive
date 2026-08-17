/* External avatar hosts are user-configured and cannot be safely enumerated for next/image. */
/* eslint-disable @next/next/no-img-element */
interface CharacterAvatarProps {
  name: string;
  src: string | null;
  className?: string;
}

export function CharacterAvatar({ name, src, className = "" }: CharacterAvatarProps) {
  return (
    <div
      aria-label={`${name} avatar`}
      role="img"
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-zinc-900 text-2xl font-semibold text-violet-200 ring-1 ring-inset ring-zinc-800 ${className}`}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="grid h-full w-full place-items-center bg-[radial-gradient(circle_at_35%_20%,color-mix(in_srgb,var(--accent-color)_20%,transparent),transparent_55%)]">{name.slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}
