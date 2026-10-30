/**
 * 单一样式消费层（spec 003 · 票 11 / #58）。
 *
 * 这里只钉一件**装配面**的事实：样式收敛成一处之后，**后注册的段落也必须真的进 DOM**。
 * 为什么必须单独钉：收敛前每个模块自己 append 一个 `<style>`，漏一个就少一块样式；
 * 收敛后注入点只剩这里，一旦「标签在就早退」，除第一个模块外的样式会静默不生效 ——
 * 页面不报错，只是看着不对。源码文本层的「只有一个 createElement」证明不了这件事。
 */
import { describe, expect, it } from 'vitest'

import { composedStyleText, installXuanshuStyles, registerStyleSheet, STYLE_TAG_ID } from '../../packages/xuanshu-client/src/client/styles.ts'

/** 最小假 document：只实现注入路径用到的那几件事。 */
function installFakeDocument() {
  const state = { tag: null, appended: 0 }
  const fake = {
    head: { appendChild(element) { state.tag = element; state.appended += 1 } },
    documentElement: { appendChild(element) { state.tag = element; state.appended += 1 } },
    createElement() { return { dataset: {}, textContent: '' } },
    querySelector() { return state.tag },
  }
  const previous = globalThis.document
  globalThis.document = fake
  return {
    state,
    restore() {
      if (previous === undefined) delete globalThis.document
      else globalThis.document = previous
    },
  }
}

describe('票 11 · 单一消费层：一个标签，但每段样式都要落地', () => {
  it('后注册的段落会刷新到同一个标签里（不是「标签在就早退」）', () => {
    const dom = installFakeDocument()
    try {
      const first = `/* first ${Date.now()} */ .xs-first{color:var(--xs-text-body)}`
      const second = `/* second ${Date.now()} */ .xs-second{color:var(--xs-text-body)}`
      registerStyleSheet('test/first.css', first)
      expect(installXuanshuStyles(), '第一次应真的新建标签').toBe(true)
      expect(dom.state.tag.textContent).toContain('.xs-first')
      expect(dom.state.tag.textContent).not.toContain('.xs-second')

      registerStyleSheet('test/second.css', second)
      expect(installXuanshuStyles(), '第二次不该再建标签（幂等）').toBe(false)
      expect(dom.state.appended, '标签只能有一个').toBe(1)
      expect(dom.state.tag.textContent, '后注册的段落必须落地').toContain('.xs-second')
      expect(dom.state.tag.textContent).toContain('.xs-first')

      // 同一份登记重复 install：内容不变，不重写
      const before = dom.state.tag.textContent
      installXuanshuStyles()
      expect(dom.state.tag.textContent).toBe(before)
    } finally {
      dom.restore()
    }
  })

  it('合成文本按登记顺序拼接；标签 id 只有一个稳定值', () => {
    registerStyleSheet('test/order-a.css', '.a{}')
    registerStyleSheet('test/order-b.css', '.b{}')
    const composed = composedStyleText()
    expect(composed.indexOf('.a{}')).toBeLessThan(composed.indexOf('.b{}'))
    expect(STYLE_TAG_ID).toBe('xuanshu-client/styles.css')
  })

  it('无 DOM 的环境安静返回 false（SSR / 产物物化 / 断言台不会因为注入而崩）', () => {
    const previous = globalThis.document
    delete globalThis.document
    try {
      expect(installXuanshuStyles()).toBe(false)
    } finally {
      if (previous !== undefined) globalThis.document = previous
    }
  })
})
