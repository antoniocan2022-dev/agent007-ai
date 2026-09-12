// Answers "what can you do now / what upgrades have you had" with a real, bounded description of
// the CEO Evidence & Supervision Layer and document/media knowledge-base pipeline, instead of the
// CEO guessing or reciting stale facts. upgrade-manifest.ts (the codebase's older "permanent
// upgrade record") stopped being maintained many phases ago -- none of the executive-state,
// leadership, decision-synthesis, or evidence/supervision work from this session's recent phases is
// registered there, so extending it further would only compound a list the CEO already can't trust.
// This module instead describes only the two most recent, verified-wired feature sets directly, and
// checks live environment configuration so it never claims a capability that's actually disabled in
// this deployment (e.g. transcription without GROQ_API_KEY configured).
//
// Gated on the self-reflection classifier's existing 'capability_assessment' kind (ceo-self-
// reflection.ts) -- a question like "what are your capabilities/strengths/limitations" -- so this
// never adds noise to an ordinary turn, the same conditional-inclusion discipline every other
// context module (self_inspection, knowledge, evidence, mission) already follows.

export function renderCeoCapabilityBriefing(): string {
  const transcriptionConfigured = Boolean(process.env.GROQ_API_KEY?.trim())
  const semanticSearchConfigured = Boolean(process.env.MISTRAL_API_KEY?.trim())

  const lines = [
    'CEO CAPABILITY BRIEFING (real, bounded facts about recent additions -- state these accurately, never round up to "any file" or "any type"):',
    '',
    'Evidence & supervision:',
    '- Before answering a recommendation/decision, or a question about past attempts, checks its own open recommendations and recent execution outcomes (successes, failures, still-running work) rather than guessing. Read-only: it never re-triggers or replays a past action.',
    '- A human owner can record a review verdict (reviewed / approved / flagged / corrected / closed) against any recommendation. The count of owner-reviewed recommendations is now part of the executive decision ledger.',
    '',
    'Knowledge base (documents the user has uploaded):',
    '- Real text extraction for PDF (including compressed content streams, not just plain uncompressed text), DOCX, XLSX, and PPTX -- not a placeholder that only handles .txt/.md/.csv/.json.',
    `- Audio/video transcription for mp3, wav, ogg, flac, m4a, mp4, and webm is ${transcriptionConfigured ? 'configured and available' : 'built but NOT currently configured in this environment (requires GROQ_API_KEY)'}. Other video containers (avi, mov, mkv) are not supported -- there is no transcoding toolchain here to convert them.`,
    '- Files up to 5MB can be uploaded directly; larger files (up to 200MB) can be ingested from the existing large-file storage path, verified end-to-end (real size and checksum against the original upload) before any of it is read.',
    `- Search blends exact keyword matching with ${semanticSearchConfigured ? 'embedding-based semantic recovery (configured), so related content can surface even without shared vocabulary with the query' : 'keyword matching only in this environment -- semantic recovery is built but not configured (requires MISTRAL_API_KEY), so a genuinely related chunk with no shared vocabulary with the query will not surface yet'}.`,
    '- Relevant excerpts from the knowledge base are already surfaced automatically during conversation when they match what is being discussed -- no separate "search my documents" step is required.',
    '',
    'What this does not do: it cannot process a file synchronously beyond ~200MB, cannot transcribe unsupported video containers, and does not fabricate an extraction result when a PDF has no real text layer (e.g. a scanned image) -- it says so honestly instead.',
  ]
  return lines.join('\n')
}
