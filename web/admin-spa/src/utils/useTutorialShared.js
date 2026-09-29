import { reactive, ref } from 'vue'
import { getModelsApi } from '@/utils/http_apis'

/**
 * 教程页共用的 API Key。只保存在内存里（不写 localStorage），
 * 切换教程 / 操作系统时无需重新填写，刷新页面即清空。
 */
export const tutorialApiKey = ref('')

const relayModels = reactive({ claude: [], openai: [], gemini: [] })
let loading = null

/** 当前服务可用模型（/apiStats/models），全站只请求一次；失败时下次挂载再试 */
export const useRelayModels = () => {
  if (!loading) {
    loading = getModelsApi()
      .then((result) => {
        if (result?.success && result.data) {
          Object.keys(relayModels).forEach((group) => {
            relayModels[group] = Array.isArray(result.data[group]) ? result.data[group] : []
          })
        } else {
          loading = null
        }
      })
      .catch(() => {
        loading = null
      })
  }
  return relayModels
}

/** 按前缀筛出模型，没有匹配时返回兜底清单 */
export const filterModels = (list, pattern, fallback) => {
  const picked = (Array.isArray(list) ? list : []).filter(
    (m) => m && typeof m.value === 'string' && pattern.test(m.value)
  )
  return picked.length ? picked : fallback
}
