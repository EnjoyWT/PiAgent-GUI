import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../../../src/renderer/src/components/chat/SecretPrompt.vue', import.meta.url),
  'utf8'
)

test('SecretPrompt supports toggling secret visibility', () => {
  assert.match(source, /import\s+\{\s*Eye,\s*EyeOff\s*\}\s+from\s+'lucide-vue-next'/)
  assert.match(source, /const\s+isSecretVisible\s*=\s*ref\(false\)/)
  assert.match(source, /:type="isSecretVisible\s+\?\s+'text'\s+:\s+'password'"/)
  assert.match(source, /@click="isSecretVisible\s*=\s*!isSecretVisible"/)
  assert.match(source, /<Eye\s+v-if="!isSecretVisible"/)
  assert.match(source, /<EyeOff\s+v-else/)
})

test('SecretPrompt hides the secret again when the prompt changes', () => {
  assert.match(source, /isSecretVisible\.value\s*=\s*false/)
})
