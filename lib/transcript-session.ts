import type { TranscriptEntry, TranscriptSession } from "./browser-storage";
import { MODEL_ADAPTERS, type LanguageId } from "./model-adapters";

export type TranscriptWorkspaces = Partial<Record<LanguageId, TranscriptSession>>;
const EMPTY_ENTRIES: TranscriptEntry[] = [];

/** Drafts stay in memory, separated by sign language. Only Save & clear writes history. */
export function updateTranscript(
  workspaces: TranscriptWorkspaces,
  language: LanguageId,
  update: (entries: TranscriptEntry[]) => TranscriptEntry[],
): TranscriptWorkspaces {
  const previous = workspaces[language];
  const entries = update(previous?.entries ?? EMPTY_ENTRIES);
  if (entries === previous?.entries || (!previous && !entries.length)) return workspaces;
  if (!entries.length) {
    const next = { ...workspaces };
    delete next[language];
    return next;
  }
  return {
    ...workspaces,
    [language]: {
      id: previous?.id ?? `${language}-${entries[0].id}`,
      language,
      createdAt: previous?.createdAt ?? entries[0].timestamp,
      entries,
    },
  };
}

export function transcriptText(session: TranscriptSession) {
  return session.entries.map(entry => entry.text).join(" ");
}

export function transcriptDocument(session: TranscriptSession) {
  return [
    `SignRelay — ${MODEL_ADAPTERS[session.language].language}`,
    new Date(session.createdAt).toISOString(),
    "Research preview. Review and correct these suggestions before using them.",
    "",
    ...session.entries.map(entry => `[${new Date(entry.timestamp).toISOString()}] ${entry.text}`),
    "",
  ].join("\n");
}
