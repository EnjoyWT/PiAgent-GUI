import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertSafeWebFetchUrl,
  normalizeWebFetchUrl
} from '../../../src/main/webfetch/url-safety.ts'

test('normalizeWebFetchUrl trims and requires http or https URLs', () => {
  assert.equal(normalizeWebFetchUrl(' https://example.com/docs '), 'https://example.com/docs')
  assert.equal(normalizeWebFetchUrl('http://example.com'), 'http://example.com/')

  assert.throws(() => normalizeWebFetchUrl('file:///etc/passwd'), /Only http and https URLs/)
  assert.throws(() => normalizeWebFetchUrl('data:text/plain,hello'), /Only http and https URLs/)
  assert.throws(() => normalizeWebFetchUrl('not a url'), /Invalid URL/)
})

test('assertSafeWebFetchUrl rejects local and private network targets', () => {
  for (const url of [
    'http://localhost:3000',
    'http://foo.localhost',
    'http://127.0.0.1',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://192.168.1.1',
    'http://169.254.169.254',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/'
  ]) {
    assert.throws(() => assertSafeWebFetchUrl(url), /not allowed/, url)
  }
})

test('assertSafeWebFetchUrl allows public http and https URLs', () => {
  assert.equal(assertSafeWebFetchUrl('https://example.com/a?q=1'), 'https://example.com/a?q=1')
  assert.equal(assertSafeWebFetchUrl('http://example.org'), 'http://example.org/')
})
