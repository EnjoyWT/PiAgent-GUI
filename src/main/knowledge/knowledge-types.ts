import type { KnowledgeEntityType, KnowledgeClaimKind, KnowledgeRelationType, KnowledgeReflectionType } from '../../shared/knowledge.ts';

export interface EntityRow {
  id: string;
  type: string;
  canonical_name: string;
  slug: string;
  aliases_json: string; // JSON string representing string[]
  summary: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ClaimRow {
  id: string;
  entity_id: string | null;
  kind: string;
  text: string;
  normalized_text: string;
  confidence: number;
  importance: number;
  status: string;
  source_type: string;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvidenceRow {
  id: string;
  claim_id: string;
  source_kind: string;
  source_ref: string;
  conversation_id: string | null;
  thread_id: string | null;
  message_id: string | null;
  agent_run_id: string | null;
  excerpt: string;
  created_at: string;
}

export interface RelationRow {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  relation_type: string;
  confidence: number;
  evidence_claim_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ReflectionRow {
  id: string;
  entity_id: string | null;
  reflection_type: string;
  title: string;
  body: string;
  source_claim_ids_json: string; // JSON representing string[]
  confidence: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertEntityInput {
  type: KnowledgeEntityType;
  canonicalName: string;
  aliases?: string[];
  summary?: string | null;
}

export interface InsertClaimInput {
  entityId: string | null;
  kind: KnowledgeClaimKind;
  text: string;
  confidence?: number;
  importance?: number;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface AttachEvidenceInput {
  claimId: string;
  sourceKind: 'message' | 'run' | 'conversation' | 'manual';
  sourceRef: string;
  conversationId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  agentRunId?: string | null;
  excerpt: string;
}

export interface InsertRelationInput {
  fromEntityId: string;
  toEntityId: string;
  relationType: KnowledgeRelationType;
  confidence?: number;
  evidenceClaimId?: string | null;
}

export interface InsertReflectionInput {
  entityId: string | null;
  reflectionType: KnowledgeReflectionType;
  title: string;
  body: string;
  sourceClaimIds?: string[];
  confidence?: number;
}
