<template>
  <div class="tutorial-section">
    <!-- 第一步：安装 Node.js -->
    <NodeInstallTutorial :platform="platform" :step-number="1" tool-name="Droid CLI" />

    <!-- 第二步：配置 Droid CLI -->
    <div class="mb-4 sm:mb-10 sm:mb-6">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >2</span
        >
        配置 Droid CLI
      </h4>
      <TutorialApiKeyInput>
        <strong>方式一：一键配置（推荐）。</strong>脚本会在 <code>{{ droidSettingsPath }}</code> 的
        <code>customModels</code> 中添加（或更新）指向本服务的 Claude 与 GPT
        自定义模型；其他模型和设置保持不变，原文件备份为 <code>.bak</code>。
      </TutorialApiKeyInput>
      <div
        class="mb-4 rounded-lg border border-blue-200 bg-white p-3 dark:border-blue-700 dark:bg-gray-800 sm:mb-6 sm:p-4"
      >
        <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
          一键配置脚本
        </h6>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
          在 {{ shellName }} 中整段粘贴执行：
        </p>
        <div class="tutorial-command-box">
          <div
            v-for="(line, index) in oneClickLines"
            :key="`droid-${index}`"
            class="whitespace-nowrap text-gray-300"
          >
            {{ line }}
          </div>
        </div>
        <p class="mt-2 text-xs text-gray-600 dark:text-gray-400">
          💡 输出 <code>Updated ...</code> 即写入成功；启动 <code>droid</code> 后用
          <code>/model</code> 选择带 <code>[crs]</code> 后缀的自定义模型。
        </p>
      </div>

      <p class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
        方式二：手动编辑配置文件
      </p>
      <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
        Droid CLI 使用
        <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">~/.factory/config.json</code>
        保存自定义模型；
        <template v-if="platform === 'windows'">
          在 Windows 中可直接编辑
          <code class="rounded bg-gray-100 px-1 dark:bg-gray-800"
            >C:\Users\你的用户名\.factory\config.json</code
          >。
        </template>
        <template v-else>
          在终端中可使用
          <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">vim ~/.factory/config.json</code>
          编辑。
        </template>
      </p>
      <div
        class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/40 dark:bg-blue-950/30 sm:p-4"
      >
        <h6 class="mb-2 text-sm font-medium text-blue-800 dark:text-blue-200 sm:text-base">
          配置文件示例
        </h6>
        <p class="mb-3 text-sm text-blue-700 dark:text-blue-200">
          将以下内容追加到配置文件中，并替换示例中的域名和 API 密钥：
        </p>
        <div class="tutorial-code-box">
          <div
            v-for="(line, index) in droidCliConfigLines"
            :key="line + index"
            class="whitespace-pre text-gray-300"
          >
            {{ line }}
          </div>
        </div>
        <p class="mt-3 text-xs text-blue-700 dark:text-blue-200 sm:text-sm">
          💡 在 Droid CLI 中选择自定义模型即可使用新的 Droid 账号池；确保服务地址可被本地访问。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useTutorialUrls } from '@/utils/useTutorialUrls'
import { tutorialApiKey } from '@/utils/useTutorialShared'
import { buildDroidScript } from '@/utils/tutorialConfigScripts'
import NodeInstallTutorial from './NodeInstallTutorial.vue'
import TutorialApiKeyInput from './TutorialApiKeyInput.vue'

const props = defineProps({
  platform: {
    type: String,
    required: true,
    validator: (value) => ['windows', 'macos', 'linux'].includes(value)
  }
})

const { droidClaudeBaseUrl, droidOpenaiBaseUrl } = useTutorialUrls()

const shellName = computed(() => (props.platform === 'windows' ? 'PowerShell' : '终端'))
const droidSettingsPath = computed(() =>
  props.platform === 'windows'
    ? '%USERPROFILE%\\.factory\\settings.json'
    : '~/.factory/settings.json'
)

const oneClickLines = computed(() =>
  buildDroidScript(props.platform, {
    apiKey: tutorialApiKey.value,
    models: [
      {
        model: 'claude-sonnet-4-5-20250929',
        displayName: 'Sonnet 4.5 [crs]',
        baseUrl: droidClaudeBaseUrl.value,
        provider: 'anthropic',
        maxOutputTokens: 8192
      },
      {
        model: 'gpt-5-codex',
        displayName: 'GPT5-Codex [crs]',
        baseUrl: droidOpenaiBaseUrl.value,
        provider: 'openai',
        maxOutputTokens: 16384
      }
    ]
  })
)

const droidCliConfigLines = computed(() => [
  '{',
  '  "custom_models": [',
  '    {',
  '      "model_display_name": "Sonnet 4.5 [crs]",',
  '      "model": "claude-sonnet-4-5-20250929",',
  `      "base_url": "${droidClaudeBaseUrl.value}",`,
  '      "api_key": "你的API密钥",',
  '      "provider": "anthropic",',
  '      "max_tokens": 8192',
  '    },',
  '    {',
  '      "model_display_name": "GPT5-Codex [crs]",',
  '      "model": "gpt-5-codex",',
  `      "base_url": "${droidOpenaiBaseUrl.value}",`,
  '      "api_key": "你的API密钥",',
  '      "provider": "openai",',
  '      "max_tokens": 16384',
  '    }',
  '  ]',
  '}'
])
</script>
