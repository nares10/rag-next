import { useCallback, useRef, useState } from "react";
import type { CitedPassage } from "@/lib/chat-types";

/**
 * Cited passages by chunk id, fetched on demand (hover or the citation panel) and kept
 * for the session. A chunk deleted since the answer was written resolves to `null`.
 */
export function useCitedPassages() {
	const [passages, setPassages] = useState<Record<string, CitedPassage | null>>({});
	const requested = useRef(new Set<string>());

	const load = useCallback(async (chunkIds: string[]) => {
		const missing = chunkIds.filter((id) => !requested.current.has(id));
		if (missing.length === 0) return;

		missing.forEach((id) => requested.current.add(id));

		try {
			const response = await fetch(`/api/rag/chunks?ids=${missing.map(encodeURIComponent).join(",")}`);
			if (!response.ok) throw new Error(`status ${response.status}`);

			const { chunks } = (await response.json()) as { chunks: CitedPassage[] };
			setPassages((current) => {
				const next = { ...current };
				for (const id of missing) next[id] = chunks.find((chunk) => chunk.id === id) ?? null;
				return next;
			});
		} catch (error) {
			// Let a later hover try again.
			missing.forEach((id) => requested.current.delete(id));
			console.error("Failed to load cited passages", error);
		}
	}, []);

	return { passages, load };
}
