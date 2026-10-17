import { afterAll, expect, it } from 'vitest'

afterAll(() => { throw new Error() })
it('known red', () => { expect(1).toBe(2) })
