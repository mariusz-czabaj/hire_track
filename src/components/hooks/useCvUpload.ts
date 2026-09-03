import { useState } from "react";
import type {
  ApiErrorBody,
  CandidateCvDto,
  ConfirmCvUploadCommand,
  CreateCvUploadIntentCommand,
  CvUploadIntentDto,
} from "@/types";

export type CvUploadStatus = "idle" | "loading" | "success" | "error";

const DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again.";
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export interface UseCvUploadResult {
  upload: (file: File) => Promise<CandidateCvDto | undefined>;
  status: CvUploadStatus;
  error: string | null;
  fieldErrors: Record<string, string> | undefined;
}

function validateFile(file: File): string | null {
  if (file.size > MAX_SIZE_BYTES) {
    return "File is too large -- the limit is 5 MB.";
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return "Only PDF or Word (.docx) files are accepted.";
  }
  return null;
}

async function readErrorMessage(response: Response): Promise<{ message: string; fields?: Record<string, string> }> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return { message: body.error.message || DEFAULT_ERROR_MESSAGE, fields: body.error.fields };
  } catch {
    return { message: DEFAULT_ERROR_MESSAGE };
  }
}

/**
 * Orchestrates the three-step CV upload: pre-validate the file client-side,
 * mint an upload intent, PUT the bytes straight to the signed URL (never the
 * Worker), then confirm. The signed URL is requested immediately before the
 * PUT, never earlier, since its TTL is short and not configurable.
 */
export function useCvUpload(candidateId: string): UseCvUploadResult {
  const [status, setStatus] = useState<CvUploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>(undefined);

  async function upload(file: File): Promise<CandidateCvDto | undefined> {
    setError(null);
    setFieldErrors(undefined);

    const validationError = validateFile(file);
    if (validationError) {
      setStatus("error");
      setError(validationError);
      return undefined;
    }

    setStatus("loading");

    const intentCommand: CreateCvUploadIntentCommand = {
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    };

    let intentResponse: Response;
    try {
      intentResponse = await fetch(`/api/candidates/${candidateId}/cv/upload-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intentCommand),
      });
    } catch {
      setStatus("error");
      setError(DEFAULT_ERROR_MESSAGE);
      return undefined;
    }

    if (intentResponse.status === 401) {
      window.location.assign("/auth/signin");
      return undefined;
    }

    if (!intentResponse.ok) {
      const { message, fields } = await readErrorMessage(intentResponse);
      setStatus("error");
      setError(message);
      setFieldErrors(fields);
      return undefined;
    }

    const intent = (await intentResponse.json()) as CvUploadIntentDto;

    let putResponse: Response;
    try {
      putResponse = await fetch(intent.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
    } catch {
      setStatus("error");
      setError(DEFAULT_ERROR_MESSAGE);
      return undefined;
    }

    if (!putResponse.ok) {
      setStatus("error");
      setError(DEFAULT_ERROR_MESSAGE);
      return undefined;
    }

    const confirmCommand: ConfirmCvUploadCommand = { cvId: intent.cvId };

    let confirmResponse: Response;
    try {
      confirmResponse = await fetch(`/api/candidates/${candidateId}/cv/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmCommand),
      });
    } catch {
      setStatus("error");
      setError(DEFAULT_ERROR_MESSAGE);
      return undefined;
    }

    if (!confirmResponse.ok) {
      const { message, fields } = await readErrorMessage(confirmResponse);
      setStatus("error");
      setError(message);
      setFieldErrors(fields);
      return undefined;
    }

    const cv = (await confirmResponse.json()) as CandidateCvDto;
    setStatus("success");
    return cv;
  }

  return { upload, status, error, fieldErrors };
}
