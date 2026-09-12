"use client";

import { startExperiment } from "@/app/actions/experiment";
import { ImagePlus, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  images: string[];
};

export function ExperimentChat() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) {
      return;
    }
    const next = [...files, ...Array.from(list)].slice(0, 6);
    setFiles(next);
    setPreviews(next.map((file) => URL.createObjectURL(file)));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || pending) {
      return;
    }

    setError(null);
    setPending(true);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: prompt,
      images: previews,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");

    const formData = new FormData();
    formData.set("prompt", prompt);
    formData.set("image_count", String(files.length));
    const result = await startExperiment(formData);

    if (result.error) {
      setError(result.error);
      setPending(false);
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "agent",
        text: "Got it. Parsing that into a structured experiment, then I’ll open a PR on your connected repo.",
        images: [],
      },
    ]);
    setFiles([]);
    setPreviews([]);
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex flex-1 flex-col gap-5 pb-6">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col justify-end gap-3">
            <p className="m-0 font-mono text-[11px] tracking-[0.16em] text-mute uppercase">
              Studio
            </p>
            <h2 className="m-0 font-display text-3xl font-extrabold tracking-tight">
              What should we try?
            </h2>
            <p className="m-0 max-w-xl text-lg leading-relaxed">
              Describe a change in plain language. Attach screenshots of the
              current UI if the layout matters.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={
                message.role === "user"
                  ? "ml-8 border border-dashed border-rule bg-ticket p-4 shadow-stamp"
                  : "mr-8"
              }
            >
              <p className="m-0 font-mono text-[11px] tracking-[0.16em] text-mute uppercase">
                {message.role === "user" ? "You" : "Agent"}
              </p>
              <p className="mt-2 mb-0 leading-relaxed">{message.text}</p>
              {message.images.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.images.map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={src}
                      src={src}
                      alt=""
                      className="h-20 w-20 object-cover"
                    />
                  ))}
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="sticky bottom-0 border-t-2 border-rule bg-paper pt-4"
      >
        {previews.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {previews.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" className="h-14 w-14 object-cover" />
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="mb-2 font-mono text-xs text-[#C23A2B]">{error}</p>
        ) : null}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => addFiles(event.target.files)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="grid size-12 place-items-center border border-rule"
            aria-label="Attach images"
          >
            <ImagePlus className="size-4" strokeWidth={1.75} />
          </button>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            placeholder="I want to try a different pricing model based on these screenshots…"
            className="min-h-12 flex-1 resize-none border border-rule bg-ticket px-3 py-3 outline-none focus:shadow-cta"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="grid size-12 place-items-center bg-ink text-ticket shadow-cta disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </form>
    </div>
  );
}
