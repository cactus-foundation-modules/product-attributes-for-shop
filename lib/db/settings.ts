import { prisma } from '@/lib/db/prisma'

export type PatSettings = {
  hideEmptyValues: boolean
  includeVariantValues: boolean
}

const DEFAULTS: PatSettings = { hideEmptyValues: true, includeVariantValues: true }

export async function getSettings(): Promise<PatSettings> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "pat_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  const row = rows[0]
  if (!row) return DEFAULTS
  return {
    hideEmptyValues: (row.hide_empty_values as boolean) ?? DEFAULTS.hideEmptyValues,
    includeVariantValues: (row.include_variant_values as boolean) ?? DEFAULTS.includeVariantValues,
  }
}

export async function updateSettings(fields: Partial<PatSettings>): Promise<void> {
  if (fields.hideEmptyValues === undefined && fields.includeVariantValues === undefined) return
  await prisma.$executeRaw`
    UPDATE "pat_settings" SET
      "hide_empty_values" = COALESCE(${fields.hideEmptyValues ?? null}::boolean, "hide_empty_values"),
      "include_variant_values" = COALESCE(${fields.includeVariantValues ?? null}::boolean, "include_variant_values"),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = 'singleton'
  `
}
