import { copyText } from '@/utils/tools'

const COPY_RESET_DELAY = 1600

// 按钮绝对定位在命令框（横向滚动容器）里，会随内容一起滚出可视区；
// 滚动时把滚动距离反向补回，让按钮始终停在命令框可视区域的右上角
const pinButtonToViewport = (commandBox, button) => {
  const sync = () => {
    button.style.transform = `translate(${commandBox.scrollLeft}px, ${commandBox.scrollTop}px)`
  }
  commandBox.addEventListener('scroll', sync, { passive: true })
  sync()
}

const getCommandText = (commandBox) => {
  const lines = []
  commandBox.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('tutorial-copy-button')) {
      return
    }

    const text = 'innerText' in node ? node.innerText : node.textContent
    if (!text) {
      return
    }

    text
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .forEach((line) => lines.push(line))
  })

  return lines.join('\n')
}

const setButtonState = (button, copied) => {
  button.classList.toggle('tutorial-copy-button--copied', copied)
  button.innerHTML = copied
    ? '<i class="fas fa-check" aria-hidden="true"></i><span>已复制</span>'
    : '<i class="fas fa-copy" aria-hidden="true"></i><span>复制</span>'
}

export const enhanceTutorialCommandBoxes = (root) => {
  if (!root) {
    return
  }

  root.querySelectorAll('.tutorial-command-box').forEach((commandBox) => {
    if (commandBox.dataset.copyEnhanced === 'true') {
      return
    }

    commandBox.dataset.copyEnhanced = 'true'
    commandBox.classList.add('tutorial-command-box--copyable')

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'tutorial-copy-button'
    button.setAttribute('aria-label', '复制命令')
    button.setAttribute('title', '复制命令')
    setButtonState(button, false)

    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()

      const text = getCommandText(commandBox)
      if (!text) {
        return
      }

      const copied = await copyText(text, '命令已复制')
      if (copied) {
        setButtonState(button, true)
        window.setTimeout(() => setButtonState(button, false), COPY_RESET_DELAY)
      }
    })

    commandBox.appendChild(button)
    pinButtonToViewport(commandBox, button)
  })
}
