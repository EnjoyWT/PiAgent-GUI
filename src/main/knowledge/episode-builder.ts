export interface KnowledgeEpisode {
  threadId: string | null;
  conversationId: string;
  agentRunId: string | null;
  workspacePath: string | null;
  userText: string;
  assistantText: string;
  toolSummaries: string;
  sourceMessageIds: string[];
  createdAt: string;
}

export interface BuildEpisodeInput {
  threadId?: string | null;
  conversationId: string;
  agentRunId?: string | null;
  workspacePath?: string | null;
  messages: Array<{
    id: string;
    role: string;
    text?: string | null;
    createdAt?: string | null;
  }>;
}

export function buildKnowledgeEpisode(input: BuildEpisodeInput): KnowledgeEpisode {
  const messages = input.messages || [];
  let totalLen = 0;
  const acceptedMessages: Array<{ id: string; role: string; text: string }> = [];

  // Iterate backwards from the newest message to respect the 12,000 character limit
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const text = (msg.text || '').trim();
    if (!text) continue;

    let processedText = text;
    if (msg.role === 'tool') {
      processedText = text.slice(0, 300);
    }

    if (totalLen + processedText.length > 12000) {
      break;
    }

    totalLen += processedText.length;
    acceptedMessages.unshift({
      id: msg.id,
      role: msg.role,
      text: processedText
    });
  }

  const userText = acceptedMessages
    .filter((m) => m.role === 'user')
    .map((m) => m.text)
    .join('\n');

  const assistantText = acceptedMessages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.text)
    .join('\n');

  const toolSummaries = acceptedMessages
    .filter((m) => m.role === 'tool')
    .map((m) => m.text)
    .join('\n');

  const sourceMessageIds = acceptedMessages.map((m) => m.id);

  return {
    threadId: input.threadId || null,
    conversationId: input.conversationId,
    agentRunId: input.agentRunId || null,
    workspacePath: input.workspacePath || null,
    userText,
    assistantText,
    toolSummaries,
    sourceMessageIds,
    createdAt: new Date().toISOString()
  };
}
