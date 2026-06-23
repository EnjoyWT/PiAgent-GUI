import type { ToolDefinition } from '@enjoywt/pi-coding-agent'
import { Type } from '@sinclair/typebox'

export const widgetRendererTool: ToolDefinition = {
  name: 'widgetRenderer',
  label: 'UI Widget Renderer',
  description:
    'Render HTML widgets in the chat interface for presentation only. Use this for dashboards, rich previews, visual summaries, and non-blocking local UI. Do not use this tool to collect blocking user input, drive multi-step selection flows, or advance the run based on widget clicks. Use `questionTool` whenever the run must pause and wait for a user choice or reply.',
  parameters: Type.Object({
    placement: Type.String({
      enum: ['inline'],
      description:
        'Where to place the widget. "inline" renders the widget directly inside the current chat message flow.'
    }),
    type: Type.String({
      enum: ['html'],
      description: 'The type of widget content.'
    }),
    title: Type.Optional(
      Type.String({
        description: 'Optional title for the widget.'
      })
    ),
    html: Type.Optional(
      Type.String({
        description:
          'The HTML content to render. Use standard CSS variables for styling. Treat this as presentation HTML, not as a blocking input surface. If the workflow depends on a user choice before the model can continue, do not use widgetRenderer; use questionTool instead.'
      })
    ),
    config: Type.Optional(
      Type.Object({
        showHeader: Type.Optional(Type.Boolean({ default: true })),
        fullWidth: Type.Optional(Type.Boolean({ default: false }))
      })
    )
  }),
  execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
    return {
      content: [
        {
          type: 'text',
          text: `Widget rendered (${(params as { placement?: string; title?: string }).placement}): ${(params as { title?: string }).title || 'Untitled'}`
        }
      ],
      // Keep the full widget payload in summary so the renderer can choose native or iframe rendering.
      summary: JSON.stringify(params),
      details: params
    }
  }
}
