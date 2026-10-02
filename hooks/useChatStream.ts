import { useRef, useState } from "react";
import type { ChatUser, Citation, Grounding, Message, Provider } from "@/lib/chat-types";
import { FREE_MESSAGE_LIMIT } from "@/lib/freeMessages";

interface UseChatStreamOptions {
	input: string;
	provider: Provider;
	model: string | null;
	selectedApiKey: string | null;
	currentConversationId: string | null;
	collectionId: string | null;
	collectionName: string | null;
	useRag: boolean;
	setInput: (value: string) => void;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setUser: React.Dispatch<React.SetStateAction<ChatUser | null>>;
	setCurrentConversationId: (id: string) => void;
	updateConversationUrl: (id: string, replace?: boolean) => void;
	onConversationSaved?: (id: string) => void;
	setShowProviderModal: (show: boolean) => void;
	inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

type StreamPayload = {
	text?: string;
	conversationId?: string;
	messageId?: string | null;
	sources?: Citation[];
	grounded?: boolean;
	degraded?: boolean;
	error?: string;
};

export function useChatStream({
	input,
	provider,
	model,
	selectedApiKey,
	currentConversationId,
	collectionId,
	collectionName,
	useRag,
	setInput,
	setMessages,
	setUser,
	setCurrentConversationId,
	updateConversationUrl,
	onConversationSaved,
	setShowProviderModal,
	inputRef,
}: UseChatStreamOptions) {
	const [isLoading, setIsLoading] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	const updateMessage = (id: string, change: (message: Message) => Message) =>
		setMessages((current) => current.map((message) => (message.id === id ? change(message) : message)));

	/**
	 * Sends `text` (the composer's input by default). With `regenerate`, the last answer is
	 * replaced: the question is not appended again and the server drops the old pair once
	 * the new answer has arrived.
	 */
	const send = async (text: string, { regenerate = false }: { regenerate?: boolean } = {}) => {
		const trimmed = text.trim();
		if (!trimmed || isLoading) {
			inputRef.current?.focus();
			return;
		}

		if (!provider) {
			setShowProviderModal(true);
			return;
		}

		const searching = Boolean(collectionId && useRag && collectionName);
		const assistantId = crypto.randomUUID();
		const placeholder: Message = {
			id: assistantId,
			role: "assistant",
			text: "",
			retrieval: searching ? { phase: "searching", collectionName: collectionName! } : undefined,
		};

		setMessages((current) => {
			if (!regenerate) return [...current, { id: crypto.randomUUID(), role: "user", text: trimmed }, placeholder];

			const lastAssistant = current.findLastIndex((message) => message.role === "assistant");
			return [...current.slice(0, lastAssistant === -1 ? current.length : lastAssistant), placeholder];
		});
		if (!regenerate) setInput("");
		setIsLoading(true);
		inputRef.current?.focus();

		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const response = await fetch("/api/chat", {
				method: "POST",
				signal: controller.signal,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					message: trimmed,
					provider,
					model,
					conversationId: currentConversationId,
					apiKey: selectedApiKey,
					collectionId,
					useRag,
					regenerate,
				}),
			});

			if (!response.ok || !response.body) {
				const errorData = await response.json().catch(() => null);
				throw new Error(errorData?.error || "Failed to get a response from the AI.");
			}

			if (!selectedApiKey) {
				setUser((currentUser) => currentUser ? { ...currentUser, freeMessagesUsed: currentUser.freeMessagesUsed + 1 } : currentUser);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let fullText = "";
			// A single read is not guaranteed to hold whole SSE frames, and the first frame
			// (the citations) is the largest one on the wire. Without carrying the remainder
			// over, a frame split across two reads fails JSON.parse and is silently dropped.
			let buffer = "";
			let streamError: string | null = null;
			let finalId: string | null = null;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const frames = buffer.split("\n\n");
				buffer = frames.pop() ?? "";

				for (const line of frames) {
					const trimmedLine = line.trim();
					if (!trimmedLine.startsWith("data:")) continue;
					const rawPayload = trimmedLine.replace(/^data:\s*/, "").trim();
					if (!rawPayload || rawPayload === "[DONE]") continue;

					let payload: StreamPayload;
					try {
						payload = JSON.parse(rawPayload) as StreamPayload;
					} catch {
						continue; // Ignore malformed stream chunks.
					}

					if (payload.error) {
						streamError = payload.error;
						continue;
					}
					if (payload.conversationId) {
						if (!currentConversationId) {
							setCurrentConversationId(payload.conversationId);
							updateConversationUrl(payload.conversationId, true);
						}
						onConversationSaved?.(payload.conversationId);
						finalId = payload.messageId ?? null;
						continue;
					}
					// Sent before the first token so the chips and the grounding notice can
					// render while the answer is still streaming.
					if (payload.sources) {
						const grounding: Grounding = payload.degraded
							? "degraded"
							: payload.grounded
								? "grounded"
								: "none";
						const sources = payload.sources;
						updateMessage(assistantId, (message) => ({
							...message,
							citations: sources,
							grounding,
							retrieval: message.retrieval
								? { phase: "found", collectionName: message.retrieval.collectionName, count: sources.length }
								: undefined,
						}));
						continue;
					}
					if (!payload.text) continue;
					fullText += payload.text;
					updateMessage(assistantId, (message) => ({ ...message, text: fullText }));
				}
			}

			if (streamError && !fullText) throw new Error(streamError);

			// Record the stored id so per-message state (feedback) survives a reload.
			if (finalId) {
				const storedId = finalId;
				updateMessage(assistantId, (message) => ({ ...message, storedId }));
			}
		} catch (error) {
			// Stopped by the user: keep whatever had streamed in.
			if (controller.signal.aborted) {
				updateMessage(assistantId, (message) => ({
					...message,
					text: message.text || "_Stopped._",
					retrieval: message.retrieval?.phase === "searching" ? undefined : message.retrieval,
				}));
				return;
			}

			const limitReached = error instanceof Error && error.message.includes("Free message limit reached");
			const errorMessage = limitReached
				? `You've used your ${FREE_MESSAGE_LIMIT} free messages. Please add an API key to continue.`
				: error instanceof Error ? error.message : "Something went wrong. Please try again.";
			if (limitReached) setShowProviderModal(true);
			// The empty placeholder becomes the error, rather than leaving a blank bubble.
			updateMessage(assistantId, (message) => ({
				...message,
				text: message.text || errorMessage,
				isError: !message.text,
				retrieval: undefined,
			}));
		} finally {
			abortRef.current = null;
			setIsLoading(false);
			inputRef.current?.focus();
		}
	};

	const submit = (text?: string) => send(text ?? input);

	return {
		isLoading,
		submit,
		regenerate: (question: string) => send(question, { regenerate: true }),
		stop: () => abortRef.current?.abort(),
	};
}
