/**
 * Minimal in-memory Obsidian-ish Vault for unit tests.
 *
 * The plugin's runtime touches only a narrow slice of the App/Vault API:
 * `getAbstractFileByPath`, `create`, `createFolder`, `read`, `modify`,
 * `delete`, plus the marker-class `TFile`. That's what this fake
 * implements. Anything not present is explicitly `unknown` so callers
 * can't accidentally depend on shape.
 *
 * Pair with `vi.mock("obsidian", () => import("./testing/fake-vault"))` in
 * test files so production imports of `obsidian` resolve here.
 */

export class TFile {
  path: string;
  basename: string;
  extension: string;
  parent: TFolder | null = null;

  constructor(path: string) {
    this.path = path;
    const lastSlash = path.lastIndexOf("/");
    const name = lastSlash === -1 ? path : path.slice(lastSlash + 1);
    const dot = name.lastIndexOf(".");
    this.basename = dot === -1 ? name : name.slice(0, dot);
    this.extension = dot === -1 ? "" : name.slice(dot + 1);
  }
}

export class TFolder {
  path: string;
  children: Array<TFile | TFolder> = [];

  constructor(path: string) {
    this.path = path;
  }
}

export type TAbstractFile = TFile | TFolder;

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

export const noticeLog: string[] = [];

export class Notice {
  constructor(msg: string) {
    noticeLog.push(msg);
  }
}

/**
 * The fake App exposes just `vault`. Everything else is undefined.
 */
export interface FakeApp {
  vault: FakeVault;
}

export class FakeVault {
  private files = new Map<string, string>();
  private folders = new Set<string>();

  constructor() {
    this.folders.add(""); // root
  }

  /** Pre-seed a file (used in test setup). */
  seed(path: string, contents: string): void {
    this.ensureParentFolder(path);
    this.files.set(path, contents);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    if (this.files.has(path)) {
      const f = new TFile(path);
      // Attach a lightweight parent pointer for folder-listing tests.
      const parentPath = parentOf(path);
      const parent = new TFolder(parentPath);
      parent.children = this.listChildrenAsObjects(parentPath);
      f.parent = parent;
      return f;
    }
    if (this.folders.has(path)) {
      const folder = new TFolder(path);
      folder.children = this.listChildrenAsObjects(path);
      return folder;
    }
    return null;
  }

  async create(path: string, contents: string): Promise<TFile> {
    if (this.files.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    this.ensureParentFolder(path);
    this.files.set(path, contents);
    return new TFile(path);
  }

  async createFolder(path: string): Promise<TFolder> {
    if (this.folders.has(path)) return new TFolder(path);
    this.folders.add(path);
    return new TFolder(path);
  }

  async read(file: TFile): Promise<string> {
    const v = this.files.get(file.path);
    if (v === undefined) throw new Error(`not found: ${file.path}`);
    return v;
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async modify(file: TFile, contents: string): Promise<void> {
    if (!this.files.has(file.path)) {
      throw new Error(`not found: ${file.path}`);
    }
    this.files.set(file.path, contents);
  }

  async delete(file: TAbstractFile): Promise<void> {
    if (file instanceof TFile) {
      if (!this.files.has(file.path)) {
        throw new Error(`not found: ${file.path}`);
      }
      this.files.delete(file.path);
      return;
    }
    this.folders.delete(file.path);
  }

  /** Test-only: snapshot of all files in the fake vault. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files.entries());
  }

  private ensureParentFolder(path: string): void {
    const parts = path.split("/");
    parts.pop();
    let cursor = "";
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : part;
      this.folders.add(cursor);
    }
  }

  private listChildrenAsObjects(folderPath: string): TAbstractFile[] {
    const prefix = folderPath === "" ? "" : `${folderPath}/`;
    const out: TAbstractFile[] = [];
    for (const p of this.files.keys()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (rest.includes("/")) continue;
      out.push(new TFile(p));
    }
    for (const p of this.folders) {
      if (p === folderPath) continue;
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (rest.includes("/") || rest === "") continue;
      out.push(new TFolder(p));
    }
    return out;
  }
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function makeFakeApp(): FakeApp {
  return { vault: new FakeVault() };
}

// Dummy exports so `import { App, ... } from "obsidian"` type-checks at
// runtime when this module is used as a vi.mock target. Callers only use
// the classes above; these are empty placeholders.
export class App {}
export class MarkdownView {}
export class Plugin {}
export type Editor = unknown;
export type MarkdownPostProcessorContext = unknown;
