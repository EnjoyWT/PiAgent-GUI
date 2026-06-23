import type { FastifyInstance } from 'fastify'
import { getRegisteredWidget } from '../widgets/widget-registry'

const decodeBase64UrlUtf8 = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const registerWidgetHttpRoutes = (app: FastifyInstance): void => {
  app.get('/widgets/bridge.js', async (_request, reply) => {
    reply.header('Content-Type', 'application/javascript; charset=utf-8')
    reply.header('Cache-Control', 'no-store')
    return `
      (() => {
        const params = new URLSearchParams(window.location.search);
        const uid = params.get('uid') || '';

        window.sendPrompt = () => {
          console.warn(
            '[widgetRenderer] window.sendPrompt() is disabled. ' +
            'widgetRenderer is presentation-only; use questionTool for blocking user input.'
          );
          return false;
        };

        const reportHeight = () => {
          const height = Math.max(
            document.documentElement?.scrollHeight || 0,
            document.body?.scrollHeight || 0
          );
          window.parent.postMessage({
            type: 'WIDGET_RESIZE',
            uid,
            payload: { height }
          }, '*');
        };

        window.addEventListener('load', () => {
          reportHeight();
          const observer = new ResizeObserver(() => reportHeight());
          observer.observe(document.documentElement);
        });
      })();
    `
  })

  app.get('/widgets/render', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>
    const uid = query.uid ?? ''
    const encoded = query.content ?? ''
    const decodedContent = encoded ? decodeBase64UrlUtf8(encoded) : ''
    return renderWidgetHtml(reply, uid, decodedContent)
  })

  app.get('/widgets/view/:id', async (request, reply) => {
    const params = request.params as { id?: string }
    const id = params.id ?? ''
    const widget = getRegisteredWidget(id)
    if (!widget) {
      reply.code(404)
      return 'Widget not found'
    }
    return renderWidgetHtml(reply, id, widget.html)
  })
}

const renderWidgetHtml = (
  reply: {
    header: (name: string, value: string) => void
  },
  uid: string,
  decodedContent: string
): string => {
  reply.header('Content-Type', 'text/html; charset=utf-8')
  reply.header('Cache-Control', 'no-store')
  reply.header(
    'Content-Security-Policy',
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; worker-src * data: blob:; style-src * 'unsafe-inline'; img-src * data: blob:; connect-src *; font-src * data:; frame-src *; child-src *;"
  )

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script>
      (function() {
        const originalWarn = console.warn;
        console.warn = function(...args) {
          if (args[0] && typeof args[0] === 'string' && args[0].includes('cdn.tailwindcss.com')) {
            return;
          }
          originalWarn.apply(console, args);
        };
      })();
    </script>
    <style>
      :root {
        --foreground: var(--theme-text-main, #374151);
        --background: transparent;
        --primary: var(--theme-primary, #3b82f6);
        --border: var(--theme-border-main, #e5e7eb);
      }
      body {
        margin: 0;
        padding: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: var(--foreground);
        background-color: var(--background);
        overflow-x: hidden;
      }
      .card {
        background: white;
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 12px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      .btn-primary {
        background-color: var(--primary);
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 8px;
        cursor: pointer;
      }
      .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 9999px;
        font-size: 12px;
        background-color: #f3f4f6;
      }
    </style>
  </head>
  <body data-widget-uid="${escapeHtml(uid)}">
    ${decodedContent}
    <script src="/widgets/bridge.js?uid=${encodeURIComponent(uid)}"></script>
  </body>
</html>`
}
