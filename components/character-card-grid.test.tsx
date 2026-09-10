import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterCardItem } from '@/src/lib/characters/browse';
import { CharacterCollectionsProvider } from './character-collections-provider';
import {
  BulkDeleteConfirmationDialog,
  CharacterCardGrid,
  restoreQuickViewFocus,
  selectCharacterPage,
  updateCharacterSelection,
} from './character-card-grid';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const mockCharacters: CharacterCardItem[] = [
  {
    id: "char-1",
    name: "Theron",
    avatarUrl: "/avatar-1.png",
    status: "ACTIVE",
    tokenCount: 1500,
    permanentTokenCount: 1000,
    sources: [{ platform: "JANITOR_AI", creatorName: "AuthorA", externalCreatorId: "author-a" }],
    tags: [{ name: "Fantasy", slug: "fantasy" }],
  },
  {
    id: "char-2",
    name: "Sloane",
    avatarUrl: "/avatar-2.png",
    status: "ACTIVE",
    tokenCount: 2200,
    permanentTokenCount: 1800,
    sources: [{ platform: "JANITOR_AI", creatorName: "AuthorB", externalCreatorId: "author-b" }],
    tags: [{ name: "Sci-Fi", slug: "sci-fi" }],
  },
];

describe('character page selection', () => {
  it('toggles canonical Character.id values without duplicates', () => {
    expect(updateCharacterSelection([], 'character-1', true)).toEqual(['character-1']);
    expect(updateCharacterSelection(['character-1'], 'character-1', true)).toEqual(['character-1']);
    expect(updateCharacterSelection(['character-1', 'character-2'], 'character-1', false)).toEqual(['character-2']);
  });

  it('selects only the supplied current-page IDs', () => {
    expect(selectCharacterPage(['character-1', 'character-2', 'character-1'])).toEqual(['character-1', 'character-2']);
  });

  it('restores focus to the card that opened Quick View', () => {
    const opener = { focus: vi.fn() };
    const defer = vi.fn((callback: () => void) => callback());
    restoreQuickViewFocus(opener, defer);
    expect(defer).toHaveBeenCalledOnce();
    expect(opener.focus).toHaveBeenCalledOnce();
  });
});

describe('CharacterCardGrid bulk delete authorization and UI', () => {
  it('renders Delete characters button for ADMIN when characters are selected', () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }} role="ADMIN">
        <CharacterCardGrid
          characters={mockCharacters}
          selectable
          enableBulkDelete
          selection={{
            selectedIds: ['char-1'],
            onChange: vi.fn(),
          }}
        />
      </CharacterCollectionsProvider>,
    );

    expect(html).toContain('Delete characters');
    expect(html).toContain('character-selection-delete-button');
    expect(html).toContain('1</strong> selected');
  });

  it('never renders Delete characters button for MEMBER even when characters are selected', () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }} role="MEMBER">
        <CharacterCardGrid
          characters={mockCharacters}
          selectable
          enableBulkDelete
          selection={{
            selectedIds: ['char-1'],
            onChange: vi.fn(),
          }}
        />
      </CharacterCollectionsProvider>,
    );

    expect(html).not.toContain('Delete characters');
    expect(html).not.toContain('character-selection-delete-button');
    expect(html).toContain('1</strong> selected');
  });

  it('does not render Delete characters button when selection is empty', () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }} role="ADMIN">
        <CharacterCardGrid
          characters={mockCharacters}
          selectable
          enableBulkDelete
        />
      </CharacterCollectionsProvider>,
    );

    expect(html).not.toContain('Delete characters');
    expect(html).not.toContain('character-selection-delete-button');
    expect(html).toContain('Select characters for bulk Cart actions');
  });
});

describe('BulkDeleteConfirmationDialog', () => {
  it('renders accessible dialog with bounded character preview and confirmation buttons', () => {
    const html = renderToStaticMarkup(
      <BulkDeleteConfirmationDialog
        characterIds={['char-1', 'char-2']}
        characters={mockCharacters}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="bulk-delete-title"');
    expect(html).toContain('aria-describedby="bulk-delete-description"');
    expect(html).toContain('Delete 2 characters?');
    expect(html).toContain('Theron');
    expect(html).toContain('Sloane');
    expect(html).toContain('Cancel');
    expect(html).toContain('Delete 2 characters');
  });

  it('bounds preview to 5 items with +N more indicator', () => {
    const manyIds = Array.from({ length: 8 }, (_, i) => `char-${i + 1}`);
    const manyCharacters: CharacterCardItem[] = manyIds.map((id, i) => ({
      id,
      name: `Bot ${i + 1}`,
      avatarUrl: null,
      status: "ACTIVE",
      tokenCount: 100,
      permanentTokenCount: 50,
      sources: [],
      tags: [],
    }));

    const html = renderToStaticMarkup(
      <BulkDeleteConfirmationDialog
        characterIds={manyIds}
        characters={manyCharacters}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(html).toContain('Delete 8 characters?');
    expect(html).toContain('Bot 1');
    expect(html).toContain('Bot 5');
    expect(html).toContain('+3 more');
  });
});
