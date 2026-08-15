export function parseReportAccountSelection(
  raw: string | string[] | undefined,
  availableAccountIds: number[],
): number[] {
  const available = new Set(availableAccountIds);
  const serialized = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  const requested = serialized
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && available.has(id));
  return requested.length > 0 ? [...new Set(requested)] : [...availableAccountIds];
}

export function nextReportAccountSelection(
  selectedIds: number[],
  availableAccountIds: number[],
  clickedId: number,
): number[] {
  if (!availableAccountIds.includes(clickedId)) return selectedIds;
  const allSelected = availableAccountIds.length > 0
    && selectedIds.length === availableAccountIds.length
    && availableAccountIds.every((id) => selectedIds.includes(id));
  if (allSelected) return [clickedId];
  if (selectedIds.includes(clickedId)) return selectedIds.filter((id) => id !== clickedId);
  return [...selectedIds, clickedId];
}
