import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatUser, Conversation, Message, Provider } from "@/lib/chat-types";

const initialMessages: Message[] = [];

/** Restores a stored message, including the citations the reply was grounded in. */
export function toMessage(message: Conversation["messages"][number]): Message {
	return {
		id: message.id,
		role: message.role as "assistant" | "user",
		text: message.content,
		citations: message.citations ?? undefined,
		grounding: message.citations?.length ? "grounded" : undefined,
	};
}

export function useConversations(user: ChatUser | null, conversationId?: string) {
	const router = useRouter();
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
	const [messages, setMessages] = useState<Message[]>(initialMessages);
	const [provider, setProvider] = useState<Provider>("openrouter");
	const [attachedCollectionId, setAttachedCollectionId] = useState<string | null>(null);
	const [isLoadingConversations, setIsLoadingConversations] = useState(false);

	useEffect(() => {
		if (!user) return;

		const loadConversations = async () => {
			setIsLoadingConversations(true);
			try {
				const response = await fetch("/api/conversations");
				if (!response.ok) return;

				const data = await response.json();
				setConversations(data.conversations || []);

				if (!conversationId) return;

				const conversationResponse = await fetch(`/api/conversations/${conversationId}`);
				if (!conversationResponse.ok) {
					router.replace("/");
					return;
				}

				const conversationData = await conversationResponse.json();
				const conversation = conversationData.conversation as Conversation;
				setCurrentConversationId(conversation.id);
				setProvider(conversation.provider as Provider);
				setAttachedCollectionId(conversation.collectionId ?? null);
				setMessages(conversation.messages.map(toMessage));
			} catch (error) {
				console.error("Failed to load conversations", error);
			} finally {
				setIsLoadingConversations(false);
			}
		};

		void loadConversations();
	}, [conversationId, router, user]);

	const renameConversation = async (conversation: Conversation, title: string) => {
		const response = await fetch(`/api/conversations/${conversation.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title }),
		});

		if (!response.ok) return false;

		setConversations((current) =>
			current.map((item) => (item.id === conversation.id ? { ...item, title } : item)),
		);
		return true;
	};

	/**
	 * Attaches a document collection to the open conversation, or detaches it with null.
	 * A conversation that has not been created yet (no id) only needs the local value —
	 * the chat request carries the collection id and persists it on creation.
	 */
	const attachCollection = async (collectionId: string | null) => {
		if (currentConversationId) {
			const response = await fetch(`/api/conversations/${currentConversationId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ collectionId }),
			});

			if (!response.ok) return false;
		}

		setAttachedCollectionId(collectionId);
		setConversations((current) =>
			current.map((item) => (item.id === currentConversationId ? { ...item, collectionId } : item)),
		);
		return true;
	};

	const deleteConversation = async (conversation: Conversation) => {
		const response = await fetch(`/api/conversations/${conversation.id}`, {
			method: "DELETE",
		});

		if (!response.ok) return false;

		setConversations((current) => current.filter((item) => item.id !== conversation.id));
		return true;
	};

	return {
		conversations,
		setConversations,
		currentConversationId,
		setCurrentConversationId,
		messages,
		setMessages,
		provider,
		setProvider,
		attachedCollectionId,
		setAttachedCollectionId,
		attachCollection,
		isLoadingConversations,
		renameConversation,
		deleteConversation,
		initialMessages,
	};
}