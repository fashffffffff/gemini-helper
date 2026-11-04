---
name: gemini-helper
description: Delegate straightforward web research, source gathering, drafting, rewriting, translation, and small text or code edits to Gemini through the google-pro MCP. Use automatically when these are separable parts of the user's task, or when the user asks to use Gemini for text, files, or image generation.
---

Use `google_delegate` for a first pass on independent, low-risk work. Prefer it for a short factual lookup with sources, a draft from a brief, or a rewrite with clear requirements. Keep trivial answers and tightly coupled work in the main conversation.

- Research: pass only the public question. Ask it to use its web search tool. Request direct URLs, publication dates where relevant, and a distinction between checked sources and inference. Verify key claims and follow any mandatory browsing rules yourself.
- Writing: give Gemini the audience, tone, length, and facts to preserve. Read the draft before presenting it.
- File work: pass the minimum necessary text files as relative paths and contents. Gemini edits copies. Review the returned changes before applying them under the user's original authorization.
- Keep credentials and unrelated private data out of delegated prompts. Respect requests for a specific model or tool. If the tool is unavailable or fails, continue through an available route and accurately report who did the work. Do not retry an account or quota error automatically.

- Images: call `google_image` when the user asks for Gemini or Nano Banana. Use the returned local file. If Google reports a quota or capacity error, surface it.
