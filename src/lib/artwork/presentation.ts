export interface CharacterArtworkProjection {
  id: string;
  avatarUrl?: string | null;
  avatarUrlOverride?: string | null;
  artworkSha256?: string | null;
}

export function resolveCharacterArtworkUrl(character: CharacterArtworkProjection): string | null {
  if (character.avatarUrlOverride) return character.avatarUrlOverride;
  if (character.artworkSha256) {
    return `/api/characters/${encodeURIComponent(character.id)}/artwork?v=${character.artworkSha256}`;
  }
  return character.avatarUrl ?? null;
}
