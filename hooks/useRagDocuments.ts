import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatUser, RagCollection, RagDocument } from "@/lib/chat-types";

const POLL_INTERVAL_MS = 2000;
/** Five minutes. A document still not terminal by then is stuck, not slow. */
const MAX_POLLS = 150;

const isTerminal = (document: RagDocument) =>
  document.status === "ready" || document.status === "failed";

/** A file on its way to the server; it becomes a RagDocument once the POST succeeds. */
export type PendingUpload = {
	id: string;
	collectionId: string;
	file: File;
	status: "uploading" | "failed";
	/** Bytes sent so far, 0–1. */
	progress: number;
	error: string | null;
};

/**
 * POSTs a form with upload progress, which fetch cannot report. Resolves with the
 * response status and parsed JSON body (null if it wasn't JSON).
 */
function postWithProgress(url: string, body: FormData, onProgress: (fraction: number) => void) {
	return new Promise<{ status: number; data: Record<string, unknown> | null }>((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open("POST", url);
		request.upload.onprogress = (event) => {
			if (event.lengthComputable) onProgress(event.loaded / event.total);
		};
		request.onload = () => {
			let data = null;
			try {
				data = JSON.parse(request.responseText);
			} catch {
				// Not JSON; the status alone decides.
			}
			resolve({ status: request.status, data });
		};
		request.onerror = () => reject(new Error("Network error"));
		request.send(body);
	});
}

function fileBody(collectionId: string, file: File, title?: string): FormData {
	const form = new FormData();
	form.set("collectionId", collectionId);
	form.set("file", file);
	if (title) form.set("title", title);

	return form;
}

/**
 * Collections and their documents for the signed-in user.
 *
 * Documents are processed in the background after upload, so this polls while any of
 * them is still pending or processing, and stops as soon as they are all terminal.
 */
export function useRagDocuments(user: ChatUser | null) {
	const [collections, setCollections] = useState<RagCollection[]>([]);
	const [hasLoadedCollections, setHasLoadedCollections] = useState(false);
	const [documents, setDocuments] = useState<RagDocument[]>([]);
	const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
	// Read by upload callbacks that resolve after the user may have switched collections.
	const activeCollectionIdRef = useRef<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Bumped whenever a document is added or retried, to restart a poll loop that has
	// already settled — otherwise a new document sits at "Queued" until the collection is
	// re-selected.
	const [pollToken, setPollToken] = useState(0);
	const [uploads, setUploads] = useState<PendingUpload[]>([]);
	// The server does not keep uploaded bytes, so a failed file can only be retried from
	// the copy still held by this tab.
	const uploadedFiles = useRef(new Map<string, File>());

	const loadCollections = useCallback(async () => {
		try {
			const response = await fetch("/api/rag/collections");
			if (!response.ok) return;

			const data = await response.json();
			setCollections(data.collections || []);
		} catch (cause) {
			console.error("Failed to load collections", cause);
		} finally {
			setHasLoadedCollections(true);
		}
	}, []);

	const loadDocuments = useCallback(async (collectionId: string) => {
		try {
			const response = await fetch(`/api/rag/documents?collectionId=${collectionId}`);
			if (!response.ok) return [];

			const data = await response.json();
			const loaded: RagDocument[] = data.documents || [];
			setDocuments(loaded);
			return loaded;
		} catch (cause) {
			console.error("Failed to load documents", cause);
			return [];
		}
	}, []);

	useEffect(() => {
		if (!user) return;

		const load = async () => {
			await loadCollections();
		};

		void load();
	}, [user, loadCollections]);

	useEffect(() => {
		if (!activeCollectionId) return;

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		let attempts = 0;

		const poll = async () => {
			const loaded = await loadDocuments(activeCollectionId);
			if (cancelled) return;

			attempts += 1;

			if (loaded.some((document) => !isTerminal(document)) && attempts < MAX_POLLS) {
				timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
			} else {
				// A document that just finished changes the collection's ready count.
				void loadCollections();
			}
		};

		void poll();

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [activeCollectionId, pollToken, loadDocuments, loadCollections]);

	/** Clearing the previous collection's documents belongs here, not in an effect. */
	const selectCollection = (collectionId: string | null) => {
		activeCollectionIdRef.current = collectionId;
		setActiveCollectionId(collectionId);
		setDocuments([]);
	};

	const createCollection = async (name: string) => {
		setError(null);
		const response = await fetch("/api/rag/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		});

		if (!response.ok) {
			setError((await response.json().catch(() => null))?.error || "Could not create the collection.");
			return null;
		}

		const { collection } = await response.json();
		await loadCollections();
		selectCollection(collection.id);
		return collection.id as string;
	};

	const deleteCollection = async (collectionId: string) => {
		const response = await fetch(`/api/rag/collections/${collectionId}`, { method: "DELETE" });
		if (!response.ok) return false;

		setCollections((current) => current.filter((item) => item.id !== collectionId));
		if (activeCollectionId === collectionId) selectCollection(null);
		return true;
	};

	const addDocument = async (
		collectionId: string,
		input: { text?: string; sourceUri?: string; title?: string; file?: File },
	) => {
		setError(null);
		setIsLoading(true);

		try {
			// A file goes as multipart/form-data; the browser sets the boundary itself, so
			// the Content-Type header must not be set by hand here.
			const response = await fetch("/api/rag/documents", {
				method: "POST",
				...(input.file
					? { body: fileBody(collectionId, input.file, input.title) }
					: {
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(
								input.sourceUri
									? { collectionId, sourceType: "url", sourceUri: input.sourceUri, title: input.title }
									: { collectionId, sourceType: "paste", text: input.text, title: input.title },
							),
						}),
			});

			if (!response.ok) {
				setError((await response.json().catch(() => null))?.error || "Could not add the document.");
				return false;
			}

			const { document } = await response.json();
			// Prepend immediately so the pending row (and its spinner) is visible at once,
			// then restart the poll so it is followed to a terminal state.
			setDocuments((current) => [document, ...current]);
			setPollToken((current) => current + 1);
			return true;
		} finally {
			setIsLoading(false);
		}
	};

	const postFile = async (upload: PendingUpload) => {
		try {
			const response = await postWithProgress(
				"/api/rag/documents",
				fileBody(upload.collectionId, upload.file),
				(progress) =>
					setUploads((current) => current.map((item) => (item.id === upload.id ? { ...item, progress } : item))),
			);

			if (response.status < 200 || response.status >= 300) {
				const error = (response.data?.error as string | undefined) || "Upload failed.";
				setUploads((current) =>
					current.map((item) => (item.id === upload.id ? { ...item, status: "failed", error } : item)),
				);
				return;
			}

			const document = response.data?.document as RagDocument;
			uploadedFiles.current.set(document.id, upload.file);
			setUploads((current) => current.filter((item) => item.id !== upload.id));
			setDocuments((current) =>
				document.collectionId === activeCollectionIdRef.current ? [document, ...current] : current,
			);
			setPollToken((current) => current + 1);
			void loadCollections();
		} catch {
			setUploads((current) =>
				current.map((item) =>
					item.id === upload.id ? { ...item, status: "failed", error: "Network error. Try again." } : item,
				),
			);
		}
	};

	/** Uploads several files at once; each one is tracked separately so one failure doesn't block the rest. */
	const uploadFiles = async (collectionId: string, files: File[]) => {
		setError(null);
		const pending = files.map<PendingUpload>((file) => ({
			id: crypto.randomUUID(),
			collectionId,
			file,
			status: "uploading",
			progress: 0,
			error: null,
		}));

		setUploads((current) => [...pending, ...current]);
		await Promise.all(pending.map(postFile));
	};

	const retryUpload = async (uploadId: string) => {
		const upload = uploads.find((item) => item.id === uploadId);
		if (!upload) return;

		const retrying = { ...upload, status: "uploading" as const, progress: 0, error: null };
		setUploads((current) => current.map((item) => (item.id === uploadId ? retrying : item)));
		await postFile(retrying);
	};

	const dismissUpload = (uploadId: string) =>
		setUploads((current) => current.filter((item) => item.id !== uploadId));

	const deleteDocument = async (documentId: string) => {
		const response = await fetch(`/api/rag/documents/${documentId}`, { method: "DELETE" });
		if (!response.ok) return false;

		setDocuments((current) => current.filter((item) => item.id !== documentId));
		void loadCollections();
		return true;
	};

	const retryDocument = async (documentId: string) => {
		const keptFile = uploadedFiles.current.get(documentId);
		const document = documents.find((item) => item.id === documentId);

		if (keptFile && document?.sourceType === "file") {
			await deleteDocument(documentId);
			uploadedFiles.current.delete(documentId);
			await uploadFiles(document.collectionId, [keptFile]);
			return true;
		}

		const response = await fetch(`/api/rag/documents/${documentId}/process`, { method: "POST" });
		const data = await response.json().catch(() => null);

		if (!response.ok && response.status !== 422) {
			setError(data?.error || "Could not reprocess the document.");
			return false;
		}

		if (data?.document) {
			setDocuments((current) => current.map((item) => (item.id === documentId ? data.document : item)));
		}

		setPollToken((current) => current + 1);

		return response.ok;
	};

	return {
		collections,
		hasLoadedCollections,
		documents,
		activeCollectionId,
		selectCollection,
		isLoading,
		error,
		setError,
		createCollection,
		deleteCollection,
		addDocument,
		uploads,
		uploadFiles,
		retryUpload,
		dismissUpload,
		canRetry: (document: RagDocument) =>
			document.sourceType === "url" || uploadedFiles.current.has(document.id),
		deleteDocument,
		retryDocument,
		reloadCollections: loadCollections,
	};
}
