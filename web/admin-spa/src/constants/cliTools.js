/**
 * CLI 工具清单的唯一来源。
 *
 * 原先该清单在 TutorialLandingView、TutorialView、LandingView、StartView
 * 四处各自硬编码一份，key / name / icon 完全一致，仅前两者额外带教程组件。
 * 拆成两个导出，避免只需要元信息的对外页把四个教程组件一并打进 chunk。
 */
import OpenClawTutorial from '@/components/tutorial/OpenClawTutorial.vue'
import ClaudeCodeTutorial from '@/components/tutorial/ClaudeCodeTutorial.vue'
import CodexTutorial from '@/components/tutorial/CodexTutorial.vue'
import GeminiCliTutorial from '@/components/tutorial/GeminiCliTutorial.vue'
import DroidCliTutorial from '@/components/tutorial/DroidCliTutorial.vue'

/** 仅元信息：供只渲染工具入口、不渲染教程正文的页面使用 */
export const cliToolsMeta = [
  { key: 'openclaw', name: 'OpenClaw', icon: 'fas fa-shrimp' },
  { key: 'claude-code', name: 'Claude Code', icon: 'fas fa-robot' },
  { key: 'codex', name: 'Codex', icon: 'fas fa-code' },
  { key: 'gemini-cli', name: 'Gemini CLI', icon: 'fab fa-google' },
  { key: 'droid-cli', name: 'Droid CLI', icon: 'fas fa-terminal' }
]

/**
 * Tutorial TOC step definitions per tool.
 * group: 'steps' | 'more' maps to the Finder-style sidebar section headers.
 */
export const cliToolSteps = {
  openclaw: [
    { id: 'tut-step-node', label: '安装 Node.js', icon: 'fab fa-node-js', group: 'steps' },
    { id: 'tut-step-install', label: '安装 OpenClaw', icon: 'fas fa-download', group: 'steps' },
    { id: 'tut-step-config', label: '初始化配置', icon: 'fas fa-cog', group: 'steps' }
  ],
  'claude-code': [
    { id: 'tut-step-node', label: '安装 Node.js', icon: 'fab fa-node-js', group: 'steps' },
    { id: 'tut-step-install', label: '安装 Claude Code', icon: 'fas fa-download', group: 'steps' },
    { id: 'tut-step-config', label: '设置环境变量', icon: 'fas fa-cog', group: 'steps' },
    { id: 'tut-step-usage', label: '开始使用', icon: 'fas fa-play', group: 'steps' },
    { id: 'tut-step-faq', label: '常见问题', icon: 'fas fa-wrench', group: 'more' }
  ],
  codex: [
    { id: 'tut-step-node', label: '安装 Node.js', icon: 'fab fa-node-js', group: 'steps' },
    { id: 'tut-step-install', label: '安装 Codex CLI', icon: 'fas fa-download', group: 'steps' },
    { id: 'tut-step-config', label: '配置 Codex', icon: 'fas fa-cog', group: 'steps' },
    { id: 'tut-step-usage', label: '启动并使用', icon: 'fas fa-play', group: 'steps' },
    {
      id: 'tut-step-fast',
      label: 'Fast 与原生生图',
      icon: 'fas fa-wand-magic-sparkles',
      group: 'steps',
      platform: 'macos'
    },
    { id: 'tut-step-faq', label: '常见问题', icon: 'fas fa-wrench', group: 'more' }
  ],
  'gemini-cli': [
    { id: 'tut-step-node', label: '安装 Node.js', icon: 'fab fa-node-js', group: 'steps' },
    { id: 'tut-step-config', label: '配置环境变量', icon: 'fas fa-cog', group: 'steps' }
  ],
  'droid-cli': [
    { id: 'tut-step-node', label: '安装 Node.js', icon: 'fab fa-node-js', group: 'steps' },
    { id: 'tut-step-config', label: '配置 Droid CLI', icon: 'fas fa-cog', group: 'steps' }
  ]
}

const tutorialComponents = {
  openclaw: OpenClawTutorial,
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
