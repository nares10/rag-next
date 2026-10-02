import { useState } from "react";
import { FREE_MESSAGE_LIMIT } from "@/lib/freeMessages";

interface ProviderSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (provider: string, apiKey?: string) => void;
  onKeySaved: (apiKey: { id: string; name: string; provider: string; key: string }) => void;
  apiKeys: Array<{ id: string; name: string; provider: string; key: string }>;
  isLoading: boolean;
  /** Opens with this provider already chosen (e.g. from the model picker). */
  initialProvider?: string | null;
}

const providers = [
  { id: "openrouter", name: "OpenRouter", icon: "🌐" },
  { id: "openai", name: "OpenAI", icon: "🤖" },
  { id: "anthropic", name: "Claude (Anthropic)", icon: "🧠" },
];

export default function ProviderSelectModal({
  isOpen,
  onClose,
  onSelect,
  onKeySaved,
  apiKeys,
  isLoading,
  initialProvider = null,
}: ProviderSelectModalProps) {
  const [selectedProvider, setSelectedProvider] = useState<string | null>(initialProvider);
  const [customApiKey, setCustomApiKey] = useState("");
  const [useExistingKey, setUseExistingKey] = useState(false);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [saveNewKey, setSaveNewKey] = useState(true);
  const [keyName, setKeyName] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!selectedProvider) return;
    setError("");

    let apiKey: string | undefined;
    
    if (useExistingKey && selectedKeyId) {
      const key = apiKeys.find(k => k.id === selectedKeyId);
      apiKey = key?.key;
    } else if (customApiKey.trim()) {
      apiKey = customApiKey.trim();
    }

    if (!apiKey) {
      setError(useExistingKey ? "Select a saved API key" : "Enter an API key");
      return;
    }

    if (!useExistingKey && saveNewKey && apiKey) {
      if (!keyName.trim()) {
        setError("Enter a name for this API key");
        return;
      }

      setIsSaving(true);
      try {
        const response = await fetch("/api/keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: apiKey,
            name: keyName.trim(),
            provider: selectedProvider,
          }),
        });

        if (!response.ok && response.status !== 409) {
          const data = await response.json().catch(() => null);
          setError(data?.error || "Could not save API key");
          return;
        }

        if (response.status === 201) {
          const data = await response.json();
          onKeySaved(data.apiKey);
        }
      } catch {
        setError("Could not save API key. Please try again.");
        return;
      } finally {
        setIsSaving(false);
      }
    }

    onSelect(selectedProvider, apiKey);
    handleClose();
  };

  const handleClose = () => {
    setSelectedProvider(null);
    setCustomApiKey("");
    setUseExistingKey(false);
    setSelectedKeyId(null);
    setSaveNewKey(true);
    setKeyName("");
    setError("");
    onClose();
  };

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    setCustomApiKey("");
    setUseExistingKey(false);
    setSelectedKeyId(null);
    setKeyName("");
    setError("");
  };

  const availableKeys = selectedProvider 
    ? apiKeys.filter(k => k.provider === selectedProvider)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-white">Select AI Provider</h3>
        <p className="mt-2 text-sm text-zinc-400">Choose a provider and configure your API key</p>

        {/* Provider Selection */}
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-zinc-500">Provider</p>
          <div className="grid grid-cols-1 gap-2">
            {providers.map((provider) => (
              <button
                key={provider.id}
                onClick={() => handleProviderChange(provider.id)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition ${
                  selectedProvider === provider.id
                    ? "border-accent bg-accent-soft"
                    : "border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
                }`}
              >
                <span className="text-2xl">{provider.icon}</span>
                <div>
                  <p className="font-medium text-white">{provider.name}</p>
                  <p className="text-xs text-zinc-400">
                    {apiKeys.filter((key) => key.provider === provider.id).length} saved key(s)
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* API Key Configuration */}
        {selectedProvider && (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-medium text-zinc-500">API Key</p>
            
            {availableKeys.length > 0 && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="useExisting"
                  checked={useExistingKey}
                  onChange={(e) => setUseExistingKey(e.target.checked)}
                  className="rounded border-zinc-600 bg-zinc-800 text-zinc-200 focus:ring-zinc-500"
                />
                <label htmlFor="useExisting" className="text-sm text-zinc-300">
                  Use existing API key
                </label>
              </div>
            )}

            {useExistingKey && availableKeys.length > 0 ? (
              <select
                value={selectedKeyId || ""}
                onChange={(e) => setSelectedKeyId(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
              >
                <option value="">Select a saved key</option>
                {availableKeys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.name} ({key.key.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-3">
                <input
                  type="password"
                  autoComplete="off"
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  placeholder="Enter your API key"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-zinc-500"
                />
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={saveNewKey}
                    onChange={(e) => setSaveNewKey(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-800 text-zinc-200 focus:ring-zinc-500"
                  />
                  Save this key to my account
                </label>
                {saveNewKey && (
                  <input
                    type="text"
                    autoComplete="off"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="Key name, e.g. Personal OpenAI"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-zinc-500"
                  />
                )}
              </div>
            )}

            {error && <p className="text-xs text-red-300">{error}</p>}

            <p className="text-xs text-zinc-500">
              {availableKeys.length > 0 && !useExistingKey && !saveNewKey && (
                <span className="text-yellow-500">This key will only be used for the current chat</span>
              )}
              {availableKeys.length === 0 && (
                <span className="text-yellow-500">No saved keys found. Enter a key to continue.</span>
              )}
            </p>
          </div>
        )}

        {/* Free Message Info */}
        <div className="mt-4 rounded-lg bg-zinc-800/50 p-3">
          <p className="text-xs text-zinc-400">
            💡 You have <span className="font-semibold text-white">{FREE_MESSAGE_LIMIT} free messages</span> without an API key
          </p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700 active:scale-[0.99]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedProvider || isLoading || isSaving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : isLoading ? "Loading..." : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}