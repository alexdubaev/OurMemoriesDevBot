import { expect, test } from 'bun:test'

import { quotePostgresIdentifier } from './postgres-identifier'

test('quotes identifiers without allowing embedded quotes to terminate the identifier', () => {
  expect(quotePostgresIdentifier('memoly_audit_test')).toBe('"memoly_audit_test"')
  expect(quotePostgresIdentifier('owned"; DROP DATABASE other_test; --')).toBe('"owned""; DROP DATABASE other_test; --"')
})
