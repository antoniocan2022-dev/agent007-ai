import assert from 'node:assert/strict'
import { hasUnsafeMemoryText, sanitizeMemoryText } from '../src/lib/memory-text'

const emoji = 'Launch 🚀 Agent007'
assert.equal(sanitizeMemoryText(emoji), emoji)
assert.equal(hasUnsafeMemoryText(emoji), false)

const highSurrogateOnly = `broken ${String.fromCharCode(0xd83d)} text`
assert.equal(sanitizeMemoryText(highSurrogateOnly), 'broken � text')
assert.equal(hasUnsafeMemoryText(highSurrogateOnly), true)

const lowSurrogateOnly = `broken ${String.fromCharCode(0xde80)} text`
assert.equal(sanitizeMemoryText(lowSurrogateOnly), 'broken � text')

const validSurrogatePair = `broken ${String.fromCharCode(0xd83d)}${String.fromCharCode(0xde80)} text`
assert.equal(sanitizeMemoryText(validSurrogatePair), 'broken 🚀 text')

assert.equal(sanitizeMemoryText('nul\u0000byte'), 'nul�byte')
assert.equal(sanitizeMemoryText('Cafe\u0301'), 'Café')
assert.equal(sanitizeMemoryText('clean text'), 'clean text')
assert.equal(
  sanitizeMemoryText(sanitizeMemoryText(highSurrogateOnly)),
  sanitizeMemoryText(highSurrogateOnly)
)

console.log('memory-text tests: PASS')
