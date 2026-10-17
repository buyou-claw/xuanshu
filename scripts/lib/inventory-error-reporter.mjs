import { writeFileSync } from 'node:fs'

// Vitest 4 的 TestModule/TestSuite.errors() 独立于断言结果；空 message 仍是一个错误。
const serialize = (error) => ({
  name: typeof error?.name === 'string' ? error.name : 'Error',
  message: typeof error?.message === 'string' ? error.message : '',
  stack: typeof error?.stack === 'string' ? error.stack : '',
})

export default class InventoryErrorReporter {
  onTestRunEnd(modules, unhandledErrors) {
    const path = process.env.XUANSHU_TEST_ERRORS_FILE
    if (!path) throw new Error('清单门缺少结构化错误报告路径')
    const report = {
      schema: 'xuanshu/test-errors@1',
      modules: modules.map((module) => ({
        name: module.moduleId,
        errors: [module, ...module.children.allSuites()].flatMap((suite) => suite.errors().map(serialize)),
      })),
      unhandledErrors: unhandledErrors.map(serialize),
    }
    writeFileSync(path, JSON.stringify(report))
  }
}
