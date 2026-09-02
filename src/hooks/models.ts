export interface ImportAlertState {
  message: string;
  manualCreateUrl?: string;
}

/** Pending low-confidence import candidate waiting for explicit user confirmation. */
export interface ImportReviewState {
  title: string;
  artist: string;
  spotifyTrackId?: string;
  source: string;
  confidence: number;
  lines: number;
  preview: string;
  synced: boolean;
  /** Metadata of the actually-matched song (e.g. Uta-Net) for human judgment. */
  match?: { title: string; artist: string; link: string; ambiguous?: boolean };
}
