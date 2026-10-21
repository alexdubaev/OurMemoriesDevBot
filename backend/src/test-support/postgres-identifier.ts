/** Quote a PostgreSQL identifier that comes from a validated connection URL. */
export function quotePostgresIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}
