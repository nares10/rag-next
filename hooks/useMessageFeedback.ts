import { useCallback, useState } from "react";

export type Feedback = "up" | "down";

const STORAGE_KEY = "message-feedback";

function read(): Record<string, Feedback> {
	if (typeof window === "undefined") return {};

	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
	} catch {
		return {};
	}
}

/**
 * Thumbs up/down per assistant message. Kept in this browser only — there is no server
 * column for it yet — keyed by the stored message id so it survives a reload.
 */
export function useMessageFeedback() {
	const [feedback, setFeedback] = useState<Record<string, Feedback>>(read);

	const rate = useCallback((messageId: string, value: Feedback) => {
		setFeedback((current) => {
			const next = { ...current };
			if (next[messageId] === value) delete next[messageId];
			else next[messageId] = value;

			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {
				// Storage full or unavailable: keep it for this session only.
			}
			return next;
		});
	}, []);

	return { feedback, rate };
}
