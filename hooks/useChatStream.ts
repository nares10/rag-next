import { useState } from "react";
import type { ChatUser, Citation, Grounding, Message, Provider } from "@/lib/chat-types";
import { FREE_MESSAGE_LIMIT } from "@/lib/freeMessages";

interface UseChatStreamOptions {
	input: string;
	provider: Provider;
	selectedApiKey: string | null;
	currentConversationId: string | null;
	collectionId: string | null;
	useRag: boolean;
	setInput: (value: string) => void;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setUser: React.Dispatch<React.SetStateAction<ChatUser | null>>;
	setCurrentConversationId: (id: string) => void;
	updateConversationUrl: (id: string, replace?: boolean) => void;
	setShowProviderModal: (show: boolean) => void;
	inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useChatStream({
	input,
	provider,
	selectedApiKey,
	currentConversationId,
	collectionId,
	useRag,
	setInput,
	setMessages,
	setUser,
	setCurrentConversationId,
	updateConversationUrl,
	setShowProviderModal,
	inputRef,
}: UseChatStreamOptions) {
	const [isLoading, setIsLoading] = useState(false);

	const submit = async () => {
		const trimmed = input.trim();
		if (!trimmed || isLoading) {
			inputRef.current?.focus();
			return;
		}

		if (!provider) {
			setShowProviderModal(true);
			return;
		}

		const assistantId = crypto.randomUUID();
		setMessages((current) => [
			...current,
			{ id: crypto.randomUUID(), role: "user", text: trimmed },
			{ id: assistantId, role: "assistant", text: "" },
		]);
		setInput("");
		setIsLoading(true);
		inputRef.current?.focus();

		try {
			const response = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					message: trimmed,
					provider,
					conversationId: currentConversationId,
					apiKey: selectedApiKey,
					collectionId,
					useRag,
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

					try {
						const payload = JSON.parse(rawPayload) as {
							text?: string;
							conversationId?: string;
							sources?: Citation[];
							grounded?: boolean;
							degraded?: boolean;
						};
						if (payload.conversationId && !currentConversationId) {
							setCurrentConversationId(payload.conversationId);
							updateConversationUrl(payload.conversationId, true);
						}
						// Sent before the first token so the chips and the grounding notice can
						// render while the answer is still streaming.
						if (payload.sources) {
							const grounding: Grounding = payload.degraded
								? "degraded"
								: payload.grounded
									? "grounded"
									: "none";
							setMessages((current) =>
								current.map((message) =>
									message.id === assistantId
										? { ...message, citations: payload.sources, grounding }
										: message,
								),
							);
							continue;
						}
						if (!payload.text) continue;
						fullText += payload.text;
						setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: fullText } : message));
					} catch {
						// Ignore malformed stream chunks.
					}
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error && error.message.includes("Free message limit reached")
				? `You've used your ${FREE_MESSAGE_LIMIT} free messages. Please add an API key to continue.`
				: error instanceof Error ? error.message : "Something went wrong. Please try again.";
			if (error instanceof Error && error.message.includes("Free message limit reached")) setShowProviderModal(true);
			setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: errorMessage }]);
		} finally {
			setIsLoading(false);
			inputRef.current?.focus();
		}
	};

	return { isLoading, submit };
}