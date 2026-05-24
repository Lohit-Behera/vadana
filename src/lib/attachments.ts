import { invoke, isTauri } from "@/lib/tauri";

export type StagedAttachment = {
  id: string;
  kind: "image" | "pdf";
  mime: string;
  path: string;
  filename: string;
};

export type PendingAttachment = StagedAttachment & {
  previewUrl?: string;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

function classifyFile(file: File): "image" | "pdf" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }
  return null;
}

export async function stageAttachment(file: File): Promise<StagedAttachment> {
  if (!isTauri()) {
    throw new Error("Attachments require the Vadana desktop app");
  }
  const kind = classifyFile(file);
  if (!kind) {
    throw new Error("Only images and PDF files are supported");
  }
  const max = kind === "pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (file.size > max) {
    throw new Error(`File exceeds ${max / (1024 * 1024)} MB limit`);
  }
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const staged = await invoke<StagedAttachment>("stage_attachment", {
    bytes,
    filename: file.name,
    mime: file.type || (kind === "pdf" ? "application/pdf" : "image/jpeg"),
  });
  return { ...staged, kind };
}

export function attachmentPreviewUrl(file: File): string | undefined {
  if (file.type.startsWith("image/")) {
    return URL.createObjectURL(file);
  }
  return undefined;
}

export function revokePreviewUrl(url: string | undefined): void {
  if (url) URL.revokeObjectURL(url);
}
