import type { SessionMessageInfo } from "@opencode/client"

/** Cache read rate across completed assistant messages in one session; input excludes cached reads. */
export function calculateSessionCacheRate(messages: readonly SessionMessageInfo[]) {
  let input = 0
  let read = 0
  let write = 0
  let output = 0
  let calls = 0

  for (const message of messages) {
    if (message.type !== "assistant" || !message.tokens) continue
    input += message.tokens.input
    read += message.tokens.cache.read
    write += message.tokens.cache.write
    output += message.tokens.output
    calls++
  }

  return { input, read, write, output, calls, rate: input + read > 0 ? read / (input + read) : undefined }
}
