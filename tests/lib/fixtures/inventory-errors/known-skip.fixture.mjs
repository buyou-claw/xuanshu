import { expect, it } from 'vitest'

it('known red', () => { expect(1).toBe(2) })
it.skip('intentional skip', () => {})
