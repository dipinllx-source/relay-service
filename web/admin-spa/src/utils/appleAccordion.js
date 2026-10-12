/**
 * Apple 风格折叠动画（参考 apple.com/applecare FAQ）
 *
 * 1. <details class="apple-accordion">：全局事件委托接管 summary 点击，
 *    用 Web Animations API 平滑过渡高度，内容同步淡入/下移，箭头由 CSS 旋转。
 * 2. expandEnter / expandLeave：供 <Transition :css="false"> 使用，
 *    给 v-if 控制的展开区域（如 API Keys 模型分布行）加同样的高度过渡。
 *
 * 遵守 prefers-reduced-motion：开启时直接切换，不做动画。
 */
const DURATION = 380
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const closedHeight = (details, summary) => {
  const cs = window.getComputedStyle(details)
  return (
    summary.getBoundingClientRect().height +
    parseFloat(cs.borderTopWidth || 0) +
    parseFloat(cs.borderBottomWidth || 0)
  )
}

function toggleDetails(details, summary) {
  const content = details.querySelector(':scope > .apple-accordion__content')
  const isOpenNow = details.dataset.state ? details.dataset.state === 'open' : details.open
  const opening = !isOpenNow

  // 先读当前（可能处于动画中途的）高度，再取消旧动画，避免连续点击时跳变
  const startHeight = details.getBoundingClientRect().height
  if (details._accAnim) details._accAnim.cancel()
  if (details._accContentAnim) details._accContentAnim.cancel()

  details.dataset.state = opening ? 'open' : 'closed'

  if (prefersReducedMotion() || typeof details.animate !== 'function') {
    details.open = opening
    return
  }

  if (opening) details.open = true
  const endHeight = opening
    ? details.getBoundingClientRect().height
    : closedHeight(details, summary)

  details.style.overflow = 'hidden'
  const anim = details.animate(
    { height: [`${startHeight}px`, `${endHeight}px`] },
    { duration: DURATION, easing: EASING }
  )
  details._accAnim = anim

  if (content) {
    details._accContentAnim = content.animate(
      opening
        ? { opacity: [0, 1], transform: ['translateY(-6px)', 'translateY(0)'] }
        : { opacity: [1, 0], transform: ['translateY(0)', 'translateY(-6px)'] },
      { duration: opening ? DURATION : Math.round(DURATION * 0.6), easing: EASING, fill: 'both' }
    )
  }

  anim.onfinish = () => {
    details._accAnim = null
    details.style.overflow = ''
    if (!opening) details.open = false
    if (details._accContentAnim) {
      details._accContentAnim.cancel()
      details._accContentAnim = null
    }
  }
  anim.oncancel = () => {
    details.style.overflow = ''
  }
}

let installed = false

/** 全局安装一次：接管所有 details.apple-accordion 的展开/收起 */
export function installAppleAccordion() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('click', (event) => {
    const target = event.target
    if (!target || typeof target.closest !== 'function') return
    const summary = target.closest('details.apple-accordion > summary')
    if (!summary) return
    event.preventDefault()
    toggleDetails(summary.parentElement, summary)
  })
}

const innerOf = (el) => el.querySelector('.apple-expand__inner') || el

/** <Transition :css="false" @enter="expandEnter"> */
export function expandEnter(el, done) {
  const inner = innerOf(el)
  if (prefersReducedMotion() || typeof inner.animate !== 'function') return done()
  const height = inner.scrollHeight
  inner.style.overflow = 'hidden'
  const anim = inner.animate(
    [
      { height: '0px', opacity: 0, transform: 'translateY(-6px)' },
      { height: `${height}px`, opacity: 1, transform: 'translateY(0)' }
    ],
    { duration: DURATION, easing: EASING }
  )
  const finish = () => {
    inner.style.overflow = ''
    done()
  }
  anim.onfinish = finish
  anim.oncancel = finish
}

/** <Transition :css="false" @leave="expandLeave"> */
export function expandLeave(el, done) {
  const inner = innerOf(el)
  if (prefersReducedMotion() || typeof inner.animate !== 'function') return done()
  const height = inner.getBoundingClientRect().height
  inner.style.overflow = 'hidden'
  const anim = inner.animate(
    [
      { height: `${height}px`, opacity: 1, transform: 'translateY(0)' },
      { height: '0px', opacity: 0, transform: 'translateY(-6px)' }
    ],
    { duration: Math.round(DURATION * 0.8), easing: EASING, fill: 'forwards' }
  )
  anim.onfinish = () => done()
  anim.oncancel = () => done()
}
