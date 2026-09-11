type Metadata = Record<string, unknown> | null | undefined;

function httpsImageUrl(metadata: Metadata): string | null {
  if (!metadata) return null;

  for (const key of ["avatar_url", "picture"] as const) {
    const value = metadata[key];
    if (typeof value !== "string") continue;

    const candidate = value.trim();
    if (/^https:\/\/[^\s]+$/i.test(candidate)) return candidate;
  }

  return null;
}

export function profileImageUrl(
  userMetadata: Metadata,
  identities: ReadonlyArray<{ identity_data?: Metadata }> | null | undefined,
): string | null {
  const directImage = httpsImageUrl(userMetadata);
  if (directImage) return directImage;

  for (const identity of identities ?? []) {
    const identityImage = httpsImageUrl(identity.identity_data);
    if (identityImage) return identityImage;
  }

  return null;
}
