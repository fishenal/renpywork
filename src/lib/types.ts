export type ProjectSession = {
  root: string;
  gameRoot: string;
  displayName: string;
};

export type DialogueLineKind =
  | "say"
  | "menu_caption"
  | "menu_choice"
  | "if"
  | "elif"
  | "else"
  | "scene"
  | "show"
  | "hide"
  | "play_music"
  | "play_sound"
  | "play_ambient"
  | "py_call";

export type DialogueLine = {
  id: string;
  file: string;
  line: number;
  speaker: string | null;
  /** Dialogue text, if/elif condition, show/play arg, or py_call args */
  text: string;
  kind: DialogueLineKind;
  /** Label that owns this line, if any */
  label: string | null;
  /** Nesting depth inside if/elif/else (0 = top-level) */
  branchDepth: number;
  /**
   * Whether "新增" is allowed after this line (say outside menu / screen / etc.).
   * Menu captions/choices and markers are always false.
   */
  allowInsertAfter: boolean;
  /** For kind py_call: function / method name (e.g. team_talk) */
  callName: string | null;
  /** For kind py_call: raw argument list inside (...) */
  callArgs: string | null;
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

export type CharacterRef = {
  /** Script id, e.g. lz */
  name: string;
  /** Display name from Character(...) or ## note */
  note: string | null;
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
  /** Characters from define Character / aliases */
  characters: CharacterRef[];
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
  /**
   * When `true`, rewrite say-line speaker using `speaker`
   * (`null` = narrator / no speaker token).
   */
  applySpeaker?: boolean;
  speaker?: string | null;
  /** Dialogue line id (scanned or pending:…) for staged structure saves */
  id?: string;
};

/** Client/server staged structure op (chronological). */
export type StagedStructureOp =
  | { op: "delete"; id: string; file: string }
  | {
      op: "insert";
      id: string;
      file: string;
      afterId: string;
      speaker: string | null;
      text: string;
    };

export type LineAnchor = {
  id: string;
  file: string;
  line: number;
};

export type StagedContent = {
  id: string;
  file: string;
  text: string;
  applySpeaker?: boolean;
  speaker?: string | null;
};

export type StagedSaveBody = {
  /** Scan-time line numbers for real dialogue ids in affected files */
  anchors: LineAnchor[];
  structureOps: StagedStructureOp[];
  /** Final say text/speaker for surviving lines (incl. pending inserts) */
  contents: StagedContent[];
  /** tl/ edits still by absolute line number */
  tlEdits: WriteEdit[];
};
