type SchemaField = {
  safeParse?: (value: unknown) => { success: true; data: unknown } | { success: false; error?: unknown };
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatSchemaError(fieldName: string, error: unknown): string {
  const issues = isObjectRecord(error) && Array.isArray(error.issues)
    ? error.issues
    : [];
  const message = issues
    .map((issue) => isObjectRecord(issue) && typeof issue.message === 'string' ? issue.message : '')
    .filter(Boolean)
    .join('; ');
  return message ? `${fieldName}: ${message}` : `${fieldName}: invalid value`;
}

export function applyToolSchemaDefaults(
  schema: unknown,
  input: Record<string, unknown>
): Record<string, unknown> {
  if (!isObjectRecord(schema)) {
    return input;
  }

  const next: Record<string, unknown> = { ...input };

  for (const [fieldName, fieldSchema] of Object.entries(schema)) {
    const parser = fieldSchema as SchemaField;
    if (typeof parser.safeParse !== 'function') {
      continue;
    }

    const hasProvidedValue = Object.prototype.hasOwnProperty.call(next, fieldName);
    const parsed = parser.safeParse(next[fieldName]);
    if (parsed.success) {
      next[fieldName] = parsed.data;
      continue;
    }

    if (hasProvidedValue) {
      throw new Error(formatSchemaError(fieldName, parsed.error));
    }
  }

  return next;
}
