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
      className={`grid shrink-0 place-items-center overflow-hidden bg-zinc-900 bg-cover bg-center text-2xl font-semibold text-violet-200 ring-1 ring-inset ring-zinc-800 ${className}`}
      style={src ? { backgroundImage: `url(${JSON.stringify(src).slice(1, -1)})` } : undefined}
    >
      {!src && name.slice(0, 1).toUpperCase()}
    </div>
  );
}
