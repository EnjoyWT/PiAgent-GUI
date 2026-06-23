import type { ToolDefinition } from '@enjoywt/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval-service.ts';
import { KnowledgeTraceService } from '../knowledge/knowledge-trace-service.ts';
import { KNOWLEDGE_ENTITY_TYPES, KNOWLEDGE_CLAIM_KINDS } from '../../shared/knowledge.ts';

const searchParametersSchema = Type.Object(
  {
    query: Type.String({
      description: 'Search keyword or query'
    }),
    entityType: Type.Optional(
      Type.Union([
        Type.Enum(
          KNOWLEDGE_ENTITY_TYPES.reduce((acc, val) => ({ ...acc, [val]: val }), {} as any)
        ),
        Type.Literal('all')
      ], {
        description: 'Filter search by entity type. Defaults to all.'
      })
    ),
    kind: Type.Optional(
      Type.Union([
        Type.Enum(
          KNOWLEDGE_CLAIM_KINDS.reduce((acc, val) => ({ ...acc, [val]: val }), {} as any)
        ),
        Type.Literal('all')
      ], {
        description: 'Filter search by claim kind. Defaults to all.'
      })
    ),
    limit: Type.Optional(
      Type.Number({
        description: 'Maximum number of search items to return. Defaults to 10, max 50.'
      })
    )
  },
  { additionalProperties: false }
);

export const createKnowledgeSearchTool = (
  retrievalService: KnowledgeRetrievalService = new KnowledgeRetrievalService()
): ToolDefinition => ({
  name: 'knowledgeSearchTool',
  label: 'Knowledge Search Tool',
  description: "Search long-term memory and knowledge base for facts, preferences, decisions, and constraints about persons, projects, concepts, or workspaces.",
  promptSnippet: 'knowledgeSearchTool: search long-term memory and knowledge base.',
  parameters: searchParametersSchema,
  execute: async (_toolCallId, params) => {
    const input = params as any;
    const query = String(input?.query || '').trim();
    if (!query) throw new Error('query is required');

    const result = await retrievalService.search({
      query,
      entityType: input?.entityType || 'all',
      kind: input?.kind || 'all',
      limit: input?.limit || 10
    });

    if (result.items.length === 0) {
      return {
        content: [{ type: 'text', text: `No knowledge items found for query: "${query}"` }],
        details: { query, count: 0 }
      };
    }

    const text = result.items
      .map((item, index) => {
        const entityPart = item.entityName ? `[${item.entityType}: ${item.entityName}] ` : '';
        const kindPart = `(${item.kind})`;
        let detail = `${index + 1}. Claim ID [${item.claimId}]: ${entityPart}${item.text} ${kindPart} (Confidence: ${item.confidence}, Importance: ${item.importance})`;
        if (item.evidencePreview) {
          detail += `\n   Excerpt: "${item.evidencePreview}"`;
        }
        return detail;
      })
      .join('\n\n');

    return {
      content: [{ type: 'text', text }],
      details: {
        query,
        count: result.items.length,
        items: result.items.map((it) => ({
          claimId: it.claimId,
          text: it.text,
          entityName: it.entityName,
          kind: it.kind
        }))
      }
    };
  }
});

const traceParametersSchema = Type.Object(
  {
    claimId: Type.String({
      description: 'The claim ID to trace back to its origin'
    })
  },
  { additionalProperties: false }
);

export const createKnowledgeTraceTool = (
  traceService: KnowledgeTraceService = new KnowledgeTraceService()
): ToolDefinition => ({
  name: 'knowledgeTraceTool',
  label: 'Knowledge Trace Tool',
  description: 'Trace a specific claim back to its original conversation, messages, or excerpt.',
  promptSnippet: 'knowledgeTraceTool: trace a claim to its origin.',
  parameters: traceParametersSchema,
  execute: async (_toolCallId, params) => {
    const input = params as any;
    const claimId = String(input?.claimId || '').trim();
    if (!claimId) throw new Error('claimId is required');

    const trace = traceService.trace({ claimId });
    if (!trace) {
      return {
        content: [{ type: 'text', text: `Claim not found or untraceable for ID: "${claimId}"` }],
        details: { claimId, found: false }
      };
    }

    let text = `Claim: "${trace.claim.text}"\nKind: ${trace.claim.kind}\nEntity: ${trace.entity ? `${trace.entity.canonicalName} (${trace.entity.type})` : 'None'}\nConfidence: ${trace.claim.confidence}, Importance: ${trace.claim.importance}\n\nEvidence Sources:\n`;

    if (trace.evidenceRefs.length === 0) {
      text += 'No source evidence references found.';
    } else {
      text += trace.evidenceRefs
        .map((ev, index) => {
          let line = `${index + 1}. Excerpt: "${ev.excerpt}"\n   Source: ${ev.sourceKind} (${ev.sourceRef})`;
          if (ev.conversationId) line += `, Conversation: ${ev.conversationId}`;
          if (ev.messageId) line += `, Message: ${ev.messageId}`;
          return line;
        })
        .join('\n\n');
    }

    return {
      content: [{ type: 'text', text }],
      details: {
        claimId,
        found: true,
        trace
      }
    };
  }
});
