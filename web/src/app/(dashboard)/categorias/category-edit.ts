export type CategoryEditableValues = {
  name: string;
  color: string;
  icon: string;
};

export type CategoryEditField = keyof CategoryEditableValues;

type CategoryEditResult = {
  changes: Partial<CategoryEditableValues>;
  conflicts: CategoryEditField[];
};

function sameValue(field: CategoryEditField, left: string, right: string) {
  return field === "color"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/**
 * Converte o formulário em uma alteração otimista sem sobrescrever
 * campos que mudaram em outro dispositivo enquanto o editor estava aberto.
 */
export function buildCategoryChanges(
  current: CategoryEditableValues,
  original: CategoryEditableValues,
  desired: CategoryEditableValues,
): CategoryEditResult {
  const changes: Partial<CategoryEditableValues> = {};
  const conflicts: CategoryEditField[] = [];

  for (const field of ["name", "color", "icon"] as const) {
    if (sameValue(field, desired[field], original[field])) continue;
    if (!sameValue(field, current[field], original[field])) {
      conflicts.push(field);
      continue;
    }
    changes[field] = desired[field];
  }

  return { changes, conflicts };
}
