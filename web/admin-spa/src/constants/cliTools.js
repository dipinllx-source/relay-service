/**
 * CLI 工具清单的唯一来源。
 *
 * 原先该清单在 TutorialLandingView、TutorialView、LandingView、StartView
 * 四处各自硬编码一份，key / name / icon 完全一致，仅前两者额外带教程组件。
 * 拆成两个导出，避免只需要元信息的对外页把四个教程组件一并打进 chunk。
 */
import ClaudeCodeTutorial from '@/components/tutorial/ClaudeCodeTutorial.vue'
import CodexTutorial from '@/components/tutorial/CodexTutorial.vue'
import GeminiCliTutorial from '@/components/tutorial/GeminiCliTutorial.vue'
import DroidCliTutorial from '@/components/tutorial/DroidCliTutorial.vue'

/** 仅元信息：供只渲染工具入口、不渲染教程正文的页面使用 */
export const cliToolsMeta = [
  { key: 'claude-code', name: 'Claude Code', icon: 'fas fa-robot' },
  { key: 'codex', name: 'Codex', icon: 'fas fa-code' },
  { key: 'gemini-cli', name: 'Gemini CLI', icon: 'fab fa-google' },
  { key: 'droid-cli', name: 'Droid CLI', icon: 'fas fa-terminal' }
]

const tutorialComponents = {
  'claude-code': ClaudeCodeTutorial,
  codex: CodexTutorial,
  'gemini-cli': GeminiCliTutorial,
  'droid-cli': DroidCliTutorial
}

/** 元信息 + 教程组件：供实际渲染教程正文的页面使用 */
export const cliTools = cliToolsMeta.map((tool) => ({
  ...tool,
  component: tutorialComponents[tool.key]
}))

export const findCliTool = (key) => cliTools.find((tool) => tool.key === key) || null
