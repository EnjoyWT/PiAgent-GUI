export type CustomTheme = {
  id: string
  name: string
  vars: Record<string, string>
}

export const themeBroadcast = new BroadcastChannel('app-theme-sync')

export async function loadAppTheme() {
  try {
    const [themeRes, customThemesRes] = await Promise.all([
      window.api.db.settings.get('app_theme'),
      window.api.db.settings.get('custom_themes')
    ])
    const theme = themeRes || 'modern'
    let customThemes: CustomTheme[] = []
    if (customThemesRes) {
      customThemes = JSON.parse(customThemesRes)
    }
    applyThemeCss(theme, customThemes)
    return { theme, customThemes }
  } catch (e) {
    console.error('Failed to load theme', e)
    return { theme: 'modern', customThemes: [] }
  }
}

export function applyThemeCss(themeId: string, customThemes: CustomTheme[]) {
  document.documentElement.setAttribute('data-theme', themeId)

  let styleEl = document.getElementById('custom-theme-vars')
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'custom-theme-vars'
    document.head.appendChild(styleEl)
  }

  const ct = customThemes.find((t) => t.id === themeId)
  if (ct) {
    const varsCss = Object.entries(ct.vars)
      .map(([k, v]) => `${k}: ${v} !important;`)
      .join('\n  ')
    styleEl.textContent = `:root[data-theme="${themeId}"] {\n  ${varsCss}\n}`
  } else {
    styleEl.textContent = ''
  }
}

export async function setAppTheme(themeId: string, customThemes: CustomTheme[]) {
  await window.api.db.settings.set('app_theme', themeId)
  applyThemeCss(themeId, customThemes)
  themeBroadcast.postMessage({ type: 'theme-changed' })
}

export async function saveCustomThemes(themes: CustomTheme[]) {
  await window.api.db.settings.set('custom_themes', JSON.stringify(themes))
  themeBroadcast.postMessage({ type: 'theme-changed' })
}
