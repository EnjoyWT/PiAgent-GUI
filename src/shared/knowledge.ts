export const KNOWLEDGE_ENTITY_TYPES = [
  'person',
  'project',
  'company',
  'concept',
  'workspace',
  'self',
  'unknown'
] as const;
export type KnowledgeEntityType = (typeof KNOWLEDGE_ENTITY_TYPES)[number];

export const KNOWLEDGE_CLAIM_KINDS = [
  'fact',
  'preference',
  'decision',
  'constraint',
  'task',
  'summary',
  'pattern'
] as const;
export type KnowledgeClaimKind = (typeof KNOWLEDGE_CLAIM_KINDS)[number];

export const KNOWLEDGE_RELATION_TYPES = [
  'works_on',
  'owns',
  'depends_on',
  'mentions',
  'prefers',
  'blocks',
  'decided_by'
] as const;
export type KnowledgeRelationType = (typeof KNOWLEDGE_RELATION_TYPES)[number];

export interface KnowledgeRelation {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: KnowledgeRelationType;
  confidence: number;
  evidenceClaimId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const KNOWLEDGE_REFLECTION_TYPES = [
  'entity_summary',
  'project_state',
  'person_profile',
  'decision_log',
  'open_questions',
  'pattern'
] as const;
export type KnowledgeReflectionType = (typeof KNOWLEDGE_REFLECTION_TYPES)[number];

export interface KnowledgeReflection {
  id: string;
  entityId: string | null;
  reflectionType: KnowledgeReflectionType;
  title: string;
  body: string;
  sourceClaimIds: string[];
  confidence: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSearchInput {
  query: string;
  entityType?: KnowledgeEntityType | 'all';
  entityId?: string;
  kind?: KnowledgeClaimKind | 'all';
  limit?: number;
}

export interface KnowledgeTraceInput {
  claimId: string;
}

export interface KnowledgeSearchItem {
  claimId: string;
  entityId: string | null;
  entityType: KnowledgeEntityType | null;
  entityName: string | null;
  kind: KnowledgeClaimKind;
  text: string;
  score: number;
  confidence: number;
  importance: number;
  evidencePreview: string | null;
  updatedAt: string;
}

export interface KnowledgeSearchResult {
  query: string;
  items: KnowledgeSearchItem[];
}

export interface KnowledgeTraceEvidence {
  id: string;
  claimId: string;
  sourceKind: string;
  sourceRef: string;
  conversationId: string | null;
  threadId: string | null;
  messageId: string | null;
  agentRunId: string | null;
  excerpt: string;
  createdAt: string;
}

export interface KnowledgeTraceEntity {
  id: string;
  type: KnowledgeEntityType;
  canonicalName: string;
  slug: string;
  aliases: string[];
  summary: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeTraceClaim {
  id: string;
  entityId: string | null;
  kind: KnowledgeClaimKind;
  text: string;
  normalizedText: string;
  confidence: number;
  importance: number;
  status: string;
  sourceType: string;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeTraceResult {
  claim: KnowledgeTraceClaim;
  entity: KnowledgeTraceEntity | null;
  evidenceRefs: KnowledgeTraceEvidence[];
}
