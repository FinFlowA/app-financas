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

export type CategoryTargetField = "monthly_goal" | "monthly_limit";

function sameMoney(left: number | null, right: number | null) {
  if (left === null || right === null) return left === right;
  return Math.round(left * 100) === Math.round(right * 100);
}

/**
 * Mesma regra para a meta/o limite mensal (null = sem valor): só muda o que
 * a pessoa editou e não sobrescreve uma alteração feita em outro dispositivo.
 */
export function buildTargetChange(
  current: number | null,
  original: number | null,
  desired: number | null,
): { changed: boolean; conflict: boolean } {
  if (sameMoney(desired, original)) return { changed: false, conflict: false };
  if (!sameMoney(current, original)) return { changed: false, conflict: true };
  return { changed: true, conflict: false };
}
