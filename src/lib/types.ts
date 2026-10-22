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
};

export type ProjectIndex = {
  gameRoot: string;
  files: string[];
  lines: DialogueLine[];
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
};
