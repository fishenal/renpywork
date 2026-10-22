export type ProjectSession = {
  root: string;
  gameRoot: string;
  displayName: string;
};

export type DialogueLine = {
  id: string;
  file: string;
  line: number;
  speaker: string | null;
  text: string;
  kind: "say" | "menu_caption";
  /** Label that owns this line, if any */
  label: string | null;
  /** English body from tl/, if paired */
  textEn: string | null;
  /** tl file relative to game/ */
  tlFile: string | null;
  /** line of English (or `new`) string in tl file */
  tlLine: number | null;
  /** line of `# chinese` comment in translate block (say only) */
  tlCommentLine: number | null;
  /** chinese text stored in tl `#` comment (say) or `old` (menu) */
  tlCommentZh: string | null;
  /** source text differs from tl comment / old — needs review */
  tlStale: boolean;
};

export type LabelNode = {
  id: string;
  file: string;
  line: number;
  kind: "label" | "dynamic";
};

export type GraphEdge = {
  from: string;
  to: string;
  kind: "jump" | "call" | "menu" | "dynamic";
  caption?: string;
  file: string;
  line: number;
};

export type ProjectIndex = {
  gameRoot: string;
  files: string[];
  lines: DialogueLine[];
  entryLabel: string | null;
  labels: Record<string, LabelNode>;
  edges: GraphEdge[];
  /** Labels reachable from entryLabel via static edges */
  reachable: string[];
  /** Active translation language folder under tl/ */
  tlLang: string | null;
  /** How many source lines have EN pairs */
  tlPairedCount: number;
};

export type FsEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  looksLikeRenpy: boolean;
};

export type WriteEdit = {
  file: string;
  line: number;
  text: string;
  /** When true, file may be under tl/ */
  allowTl?: boolean;
};
