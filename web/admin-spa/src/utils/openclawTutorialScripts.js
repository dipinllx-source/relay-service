/**
 * OpenClaw 教程中「配置 Claude / 配置 GPT」脚本的生成器。
 *
 * 与 OpenClawTutorial.vue 拆开成纯函数，便于在 Node 中生成同一份脚本做端到端校验
 * （执行脚本 → openclaw config patch → 真实请求中转服务）。
 *
 * 设计要点：
 * - API Key 只写入 ~/.openclaw/.env（OpenClaw 推荐的 provider 密钥位置），
 *   openclaw.json 里只保存 "${RELAY_CLAUDE_API_KEY}" 这类引用，配置文件不落明文。
 * - Claude / GPT 各用一个环境变量，二者可以是同一把 Key，也可以分开。
 * - 配置用 `openclaw config patch --stdin` 一次合并写入：对象递归合并，
 *   不影响用户已有的其他 provider；重复执行只刷新本服务这一段。
 * - 生成的脚本不含 `#` 注释行：macOS 默认 zsh 未开启 interactive_comments，
 *   粘贴注释行会报 command not found。
 */

export const API_KEY_PLACEHOLDER = '你的API密钥'

export const CLAUDE_PROVIDER_ID = 'relay-claude'
export const GPT_PROVIDER_ID = 'relay-gpt'
export const CLAUDE_ENV_KEY = 'RELAY_CLAUDE_API_KEY'
export const GPT_ENV_KEY = 'RELAY_GPT_API_KEY'

export const CLAUDE_MODEL_PATTERN = /^claude-/
export const GPT_MODEL_PATTERN = /^gpt-\d/

const MAX_MODELS = 4
const CONTEXT_WINDOW = 200000
const MAX_TOKENS = 32000

/** /apiStats/models 拉取失败时的兜底清单 */
export const DEFAULT_CLAUDE_MODELS = [
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { value: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }
]

export const DEFAULT_GPT_MODELS = [
  { value: 'gpt-6-luna', label: 'GPT-6-Luna' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' },
  { value: 'gpt-5.5', label: 'GPT-5.5' }
]

/** 从 /apiStats/models 的某一分组里挑出前几个匹配的模型，没有则用兜底清单 */
export const pickModels = (list, pattern, fallback) => {
  const picked = (Array.isArray(list) ? list : [])
    .filter((m) => m && typeof m.value === 'string' && pattern.test(m.value))
    .slice(0, MAX_MODELS)
  return picked.length ? picked : fallback
}

const q = (value) => JSON.stringify(String(value))

/** 写入 openclaw.json 的 JSON5 patch（逐行） */
export const buildProviderPatchLines = ({ providerId, envKey, baseUrl, api, models }) => [
  '{',
  'models: {',
  'mode: "merge",',
  'providers: {',
  `${q(providerId)}: {`,
  `baseUrl: ${q(baseUrl)},`,
  `apiKey: "\${${envKey}}",`,
  `api: ${q(api)},`,
  'models: [',
  ...models.map(
    (m) =>
      `{ id: ${q(m.value)}, name: ${q(m.label || m.value)}, reasoning: true, input: ["text", "image"], contextWindow: ${CONTEXT_WINDOW}, maxTokens: ${MAX_TOKENS} },`
  ),
  '],',
  '},',
  '},',
  '},',
  `agents: { defaults: { model: { primary: ${q(`${providerId}/${models[0].value}`)} } } },`,
  '}'
]

/** 把 API Key 写入 ~/.openclaw/.env；重复执行只替换同名那一行 */
export const buildEnvScriptLines = (platform, envKey, apiKey) =>
  platform === 'windows'
    ? [
        '$dir = Join-Path $env:USERPROFILE ".openclaw"',
        'New-Item -ItemType Directory -Force -Path $dir | Out-Null',
        '$envFile = Join-Path $dir ".env"',
        '$lines = @()',
        `if (Test-Path $envFile) { $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch '^${envKey}=' }) }`,
        `$lines += '${envKey}=${apiKey}'`,
        '[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))'
      ]
    : [
        'mkdir -p ~/.openclaw && touch ~/.openclaw/.env',
        `grep -v '^${envKey}=' ~/.openclaw/.env > ~/.openclaw/.env.tmp || true`,
        `echo '${envKey}=${apiKey}' >> ~/.openclaw/.env.tmp`,
        'mv ~/.openclaw/.env.tmp ~/.openclaw/.env && chmod 600 ~/.openclaw/.env'
      ]

/** 把 patch 包成可直接粘贴执行的命令：bash/zsh 用 heredoc，PowerShell 用 here-string */
export const wrapPatchScript = (platform, patchLines) =>
  platform === 'windows'
    ? ["@'", ...patchLines, "'@ | openclaw config patch --stdin"]
    : ["openclaw config patch --stdin <<'EOF'", ...patchLines, 'EOF']

const buildScript = (platform, apiKey, spec) => [
  ...buildEnvScriptLines(platform, spec.envKey, apiKey || API_KEY_PLACEHOLDER),
  ...wrapPatchScript(platform, buildProviderPatchLines(spec))
]

/** Claude：Anthropic Messages 协议，baseUrl 为 <服务地址>/api */
export const buildClaudeScriptLines = (platform, baseUrl, models, apiKey) =>
  buildScript(platform, apiKey, {
    providerId: CLAUDE_PROVIDER_ID,
    envKey: CLAUDE_ENV_KEY,
    baseUrl,
    api: 'anthropic-messages',
    models
  })

/** GPT：OpenAI Chat Completions 协议，baseUrl 为 <服务地址>/api/v1 */
export const buildGptScriptLines = (platform, baseUrl, models, apiKey) =>
  buildScript(platform, apiKey, {
    providerId: GPT_PROVIDER_ID,
    envKey: GPT_ENV_KEY,
    baseUrl,
    api: 'openai-completions',
    models
  })
