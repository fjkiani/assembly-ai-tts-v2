/**
 * Domain-specific keyterms for Universal-3 Pro STT boosting.
 * Single source of truth — mirrors the Python DOMAIN_KEYTERMS list.
 * Per AssemblyAI docs: max 100 keyterms, each ≤ 50 chars.
 */
export const DOMAIN_KEYTERMS = [
  // Brand names
  'iTranslate', 'AssemblyAI', 'EpiPen',
  // Clinician roles & context
  'primary care physician', 'triage nurse',
  'attending physician', 'on-call doctor',
  // Conditions
  'hypertension', 'type 2 diabetes',
  'shortness of breath', 'epigastric pain',
  // Medications & doses
  'ibuprofen 400 milligrams', 'paracetamol 500 milligrams',
  'insulin glargine', 'metformin', 'amoxicillin',
  'epinephrine auto-injector', 'acetaminophen',
  'metoprolol', 'lisinopril',
];
