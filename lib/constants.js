/**
 * Domain-specific keyterms for Universal-3 Pro STT boosting.
 * 
 * These are sent to the AssemblyAI WebSocket as keyterms to boost
 * recognition accuracy for domain-specific vocabulary.
 * 
 * Customize per session — interview, meeting, presentation, etc.
 * Per AssemblyAI docs: max 100 keyterms, each ≤ 50 chars.
 */
export const DOMAIN_KEYTERMS = [
  // General enterprise / cloud
  'CI/CD', 'HIPAA', 'SOC2', 'Zero-Trust', 'RBAC',
  'VPC', 'IAM', 'EKS', 'S3', 'Terraform',
  'Kubernetes', 'Docker', 'microservices',
  // Observability
  'Datadog', 'LangFuse', 'Grafana', 'Prometheus',
  'OpenTelemetry', 'distributed tracing',
  // AI/ML
  'LLM', 'RAG', 'fine-tuning', 'prompt engineering',
  'embeddings', 'vector database', 'agentic',
  'hallucination', 'guardrails', 'eval framework',
  // DevSecOps
  'DevSecOps', 'SAST', 'DAST', 'penetration testing',
  'vulnerability scanning', 'shift left',
  // Data
  'ETL', 'data pipeline', 'Talend', 'Snowflake',
  'Delta Lake', 'data governance',
  // Agile
  'sprint', 'standup', 'retrospective', 'Jira',
  'epics', 'story points',
];
