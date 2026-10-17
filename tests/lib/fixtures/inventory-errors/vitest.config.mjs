export default {
  test: {
    include: ['tests/lib/fixtures/inventory-errors/*.fixture.mjs'],
    fileParallelism: false,
  },
}
