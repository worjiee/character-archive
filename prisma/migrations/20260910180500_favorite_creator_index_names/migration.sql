-- RenameIndex
ALTER INDEX "UserFavoriteCreator_platform_identityKind_identityValue_created"
  RENAME TO "UserFavoriteCreator_platform_identityKind_identityValue_cre_idx";

-- RenameIndex
ALTER INDEX "UserFavoriteCreator_userId_platform_identityKind_identityValue_"
  RENAME TO "UserFavoriteCreator_userId_platform_identityKind_identityVa_key";
