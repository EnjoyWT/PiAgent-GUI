import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const readRepoFile = (path: string): string =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

const getStyleRule = (source: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  return match?.[1] ?? ''
}

test('chat markdown typography plugin is configured', () => {
  const packageJson = JSON.parse(readRepoFile('package.json')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const mainCss = readRepoFile('src/renderer/src/assets/main.css')
  const typographyVersion =
    packageJson.dependencies?.['@tailwindcss/typography'] ??
    packageJson.devDependencies?.['@tailwindcss/typography']

  assert.ok(typographyVersion, 'missing @tailwindcss/typography dependency')
  assert.match(
    mainCss,
    /@plugin\s+['"]@tailwindcss\/typography['"]\s*;/,
    'missing @tailwindcss/typography @plugin directive'
  )
})

test('chat markdown keeps prose but owns compact paragraph rhythm', () => {
  const markdownContent = readRepoFile('src/renderer/src/components/chat/MarkdownContent.vue')

  assert.match(
    markdownContent,
    /class="[^"]*\bprose\b/,
    'MarkdownContent should keep full markdown typography support'
  )
  assert.match(
    markdownContent,
    /\.md-content\s+:deep\(p\)[\s\S]*margin:\s*0\.35em 0/,
    'paragraph rhythm should be compact for chat'
  )
})

test('chat markdown binds typography colors to theme variables', () => {
  const markdownContent = readRepoFile('src/renderer/src/components/chat/MarkdownContent.vue')
  const themeTokenRule = getStyleRule(markdownContent, '.md-content')

  assert.match(
    themeTokenRule,
    /--tw-prose-body:\s*var\(--theme-text-main\)/,
    'markdown body text should follow the active theme'
  )
  assert.match(
    themeTokenRule,
    /--tw-prose-bold:\s*var\(--theme-text-main\)/,
    'bold markdown text should emphasize by weight without becoming brighter than body text'
  )
  assert.match(
    themeTokenRule,
    /--tw-prose-headings:\s*var\(--theme-text-bright\)/,
    'markdown headings should stay readable in dark themes'
  )
  assert.match(
    themeTokenRule,
    /--tw-prose-counters:\s*var\(--theme-text-dim\)/,
    'ordered-list counters should use themed secondary text'
  )
  assert.match(
    themeTokenRule,
    /--tw-prose-bullets:\s*var\(--theme-text-dim\)/,
    'list bullets should use themed secondary text'
  )
})

test('chat markdown inline code consumes markdown delimiters with subtle capsule styling', () => {
  const markdownContent = readRepoFile('src/renderer/src/components/chat/MarkdownContent.vue')
  const inlineCodeRule = getStyleRule(markdownContent, '.md-content :deep(code:not(pre code))')

  assert.match(inlineCodeRule, /font-family:/, 'inline code should use monospace font')
  assert.match(inlineCodeRule, /font-weight:\s*400/, 'inline code should not look bold')
  assert.match(
    inlineCodeRule,
    /background:\s*color-mix\(in srgb,\s*var\(--theme-bg-content\)\s*72%,\s*white\)/,
    'inline code should use a subtle capsule background'
  )
  assert.match(inlineCodeRule, /border-radius:\s*0\.45rem/, 'inline code should be rounded')
  assert.match(
    inlineCodeRule,
    /padding:\s*0\.34em 0\.34em/,
    'inline code should have vertical breathing room inside the capsule'
  )
  assert.doesNotMatch(inlineCodeRule, /border:/, 'inline code should not use a visible border')
  assert.match(
    markdownContent,
    /code:not\(pre code\)::before[\s\S]*content:\s*none/,
    'inline code should hide typography-generated before pseudo-content'
  )
  assert.match(
    markdownContent,
    /code:not\(pre code\)::after[\s\S]*content:\s*none/,
    'inline code should hide typography-generated after pseudo-content'
  )
})
