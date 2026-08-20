import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/app/page.tsx', 'utf8')
const chatTab = readFileSync('src/components/agent/tabs/chat-tab.tsx', 'utf8')
const chatThread = readFileSync('src/components/agent/chat-thread.tsx', 'utf8')
const sidebarRight = readFileSync('src/components/agent/sidebar-right.tsx', 'utf8')


describe('CEO chat layout integrity', () => {
  test('locks the application shell to the viewport and leaves scrolling to internal panes', () => {
    expect(page).toContain('h-dvh overflow-hidden')
    expect(page).toContain('flex-1 min-h-0 flex relative overflow-hidden')
    expect(page).toContain('h-full flex-shrink-0 w-10 sm:w-11 overflow-hidden')
    expect(chatTab).toContain('overflow-hidden')
    expect(chatTab).not.toContain('setLeft(false)')
  })

  test('keeps every loaded message addressable for history navigation', () => {
    expect(chatThread).toContain('data-chat-scroll-container="true"')
    expect(chatThread).toContain('data-chat-message-id={m.id}')
    expect(chatThread).toContain('messages.map((m) => (')
    expect(chatThread).not.toContain('MAX_MESSAGES = 50')
    expect(chatThread).not.toContain('messages.slice(-MAX_MESSAGES)')
  })

  test('renders a clickable history marker for every non-empty message', () => {
    expect(sidebarRight).toContain("messages.filter((message) => message.content.trim())")
    expect(sidebarRight).toContain('scrollToMessage(message.id)')
    expect(sidebarRight).toContain('scrollIntoView({ behavior: \'smooth\', block: \'center\' })')
    expect(sidebarRight).toContain('AGENT007')
    expect(sidebarRight).toContain('USER')
  })
})
