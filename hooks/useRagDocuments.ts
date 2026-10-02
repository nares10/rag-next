import { useCallback, useEffect, useState } from "react";
import type { ChatUser, RagCollection, RagDocument } from "@/lib/chat-types";

const POLL_INTERVAL_MS = 2000;
/** Five minutes. A document still not terminal by then is stuck, not slow. */
const MAX_POLLS = 150;

const isTerminal = (document: RagDocument) =>
  document.status === "ready" || document.status === "failed";

/**
 * Collections and their documents for the signed-in user.
 *
 * Documents are processed in the background after upload, so this polls while any of
 * them is still pending or processing, and stops as soon as they are all terminal.
 */
export function useRagDocuments(user: ChatUser | null) {
	const [collections, setCollections] = useState<RagCollection[]>([]);
	const [documents, setDocuments] = useState<RagDocument[]>([]);
	const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Bumped whenever a document is added or retried, to restart a poll loop that has
	// already settled — otherwise a new document sits at "Queued" until the collection is
	// re-selected.
	const [pollToken, setPollToken] = useState(0);

	const loadCollections = useCallback(async () => {
		try {
			const response = await fetch("/api/rag/collections");
			if (!response.ok) return;

			const data = await response.json();
			setCollections(data.collections || []);
		} catch (cause) {
			console.error("Failed to load collections", cause);
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
		input: { text?: string; sourceUri?: string; title?: string },
	) => {
		setError(null);
		setIsLoading(true);

		try {
			const response = await fetch("/api/rag/documents", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(
					input.sourceUri
						? { collectionId, sourceType: "url", sourceUri: input.sourceUri, title: input.title }
						: { collectionId, sourceType: "paste", text: input.text, title: input.title },
				),
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

	const deleteDocument = async (documentId: string) => {
		const response = await fetch(`/api/rag/documents/${documentId}`, { method: "DELETE" });
		if (!response.ok) return false;

		setDocuments((current) => current.filter((item) => item.id !== documentId));
		void loadCollections();
		return true;
	};

	const retryDocument = async (documentId: string) => {
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
		documents,
		activeCollectionId,
		selectCollection,
		isLoading,
		error,
		setError,
		createCollection,
		deleteCollection,
		addDocument,
		deleteDocument,
		retryDocument,
		reloadCollections: loadCollections,
	};
}
