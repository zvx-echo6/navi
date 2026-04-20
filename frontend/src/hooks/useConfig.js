import { useState, useEffect } from 'react'
import { loadConfig, getConfig, hasFeature } from '../config'

/**
 * Hook that returns the deployment config, loading it if needed.
 * Components using this will re-render once config is loaded.
 */
export function useConfig() {
  const [config, setConfig] = useState(getConfig)

  useEffect(() => {
    if (!config) {
      loadConfig().then(setConfig)
    }
  }, [config])

  return config
}

/**
 * Hook to check a single feature flag.
 * @param {string} flag - e.g. 'has_hillshade'
 * @returns {boolean}
 */
export function useFeature(flag) {
  const config = useConfig()
  if (!config) return false
  return Boolean(config.features?.[flag])
}
