"use client";

import {
  getExperimentProgress,
  startExperiment,
  type ExperimentProgress,
} from "@/app/actions/experiment";
import { STEP_META, STEP_ORDER } from "@/lib/pipeline/step-meta";
import type { PipelineStepName } from "@/lib/pipeline/types";
import { cn } from "@/lib/utils";
import { Check, ImagePlus, Loader2, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

const POLL_INTERVAL_MS = 1500;
const TERMINAL_STATUSES = new Set(["done", "failed", "awaiting_loop"]);
const MAX_POLL_ATTEMPTS = 120; // ~3 minutes at POLL_INTERVAL_MS
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

type StepCardStatus = "pending" | "revealing" | "done" | "error";

type StepCard = {
  step: PipelineStepName;
  status: StepCardStatus;
  message: string;
};

type RunTurn = {
  kind: "run";
  id: string;
  experimentId: string;
  steps: StepCard[];
  /** Set when polling gives up (too many attempts, or too many consecutive errors) rather than reaching a terminal status. */
  giveUpMessage: string | null;
};

type UserTurn = {
  kind: "user";
  id: string;
  text: string;
  images: string[];
};

type Turn = UserTurn | RunTurn;

export type InitialExperiment = {
  id: string;
  promptText: string;
  progress: ExperimentProgress;
};

function buildInitialTurns(initialExperiment: InitialExperiment): Turn[] {
  const userTurn: UserTurn = {
    kind: "user",
    id: `${initialExperiment.id}-prompt`,
    text: initialExperiment.promptText,
    images: [],
  };
  const runTurn: RunTurn = {
    kind: "run",
    id: `${initialExperiment.id}-run`,
    experimentId: initialExperiment.id,
    steps: computeStepCards(initialExperiment.progress),
    giveUpMessage: null,
  };
  return [userTurn, runTurn];
}

function stepMessage(step: PipelineStepName, status: StepCardStatus, progress: ExperimentProgress): string {
  if (status === "pending") {
    return "";
  }
  if (status === "revealing") {
    return "Working…";
  }

  const hypothesis = progress.activeHypothesis as
    | { element?: string; dimension?: string; variant_value?: string }
    | null;

  if (status === "error") {
    return progress.errorMessage ?? `${STEP_META[step].label} failed.`;
  }

  switch (step) {
    case "parse_request":
      return hypothesis?.element
        ? `Parsed as ${hypothesis.element}/${hypothesis.dimension} → "${hypothesis.variant_value}"`
        : "Parsed the request.";
    case "generate_diff":
      return hypothesis?.element
        ? `Prepared frontend/src/AuthPanel.tsx with ${hypothesis.element}/${hypothesis.dimension} set to "${hypothesis.variant_value}".`
        : "Prepared the diff.";
    case "open_pr": {
      const prUrl = progress.variants.find((variant) => variant.pr_url)?.pr_url;
      return prUrl ? `Opened ${prUrl}` : "Opened a pull request.";
    }
    case "create_flag": {
      const flagKey = progress.variants.find((variant) => variant.posthog_flag_key)?.posthog_flag_key;
      return flagKey ? `Created PostHog flag ${flagKey}` : "Created the feature flag.";
    }
    case "simulate_traffic":
      return "Fired synthetic traffic.";
    case "analyze_results":
      return "Analyzed results.";
    case "update_playbook":
      return "Updated the playbook.";
    case "synthesize_next":
      return "Synthesized the next hypothesis.";
    default:
      return "Done.";
  }
}

function computeStepCards(progress: ExperimentProgress): StepCard[] {
  const status = progress.status ?? "parsing";
  const currentStepIndex =
    progress.currentStep !== null
      ? STEP_ORDER.indexOf(progress.currentStep as PipelineStepName)
      : status === "done" || status === "awaiting_loop"
        ? STEP_ORDER.length
        : 0;

  return STEP_ORDER.map((step, index) => {
    let cardStatus: StepCardStatus;
    if (status === "failed" && index === currentStepIndex) {
      cardStatus = "error";
    } else if (status === "done" || status === "awaiting_loop" || index < currentStepIndex) {
      cardStatus = "done";
    } else if (index === currentStepIndex && status !== "failed") {
      cardStatus = "revealing";
    } else {
      cardStatus = "pending";
    }

    return { step, status: cardStatus, message: stepMessage(step, cardStatus, progress) };
  }).filter((card) => card.status !== "pending");
}

export function ExperimentChat({
  initialExperiment = null,
}: {
  initialExperiment?: InitialExperiment | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>(() =>
    initialExperiment ? buildInitialTurns(initialExperiment) : [],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePolls, setActivePolls] = useState<string[]>(() =>
    initialExperiment && !TERMINAL_STATUSES.has(initialExperiment.progress.status ?? "")
      ? [initialExperiment.id]
      : [],
  );
  const activePollsRef = useRef<string[]>([]);
  const pollStateRef = useRef<Map<string, { attempts: number; consecutiveErrors: number }>>(new Map());

  useEffect(() => {
    activePollsRef.current = activePolls;
  }, [activePolls]);

  useEffect(() => {
    if (activePolls.length === 0) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    function stopPolling(experimentId: string, giveUpMessage?: string) {
      pollStateRef.current.delete(experimentId);
      setActivePolls((current) => current.filter((id) => id !== experimentId));
      if (giveUpMessage) {
        setTurns((current) =>
          current.map((turn) =>
            turn.kind === "run" && turn.experimentId === experimentId
              ? { ...turn, giveUpMessage }
              : turn,
          ),
        );
      }
    }

    async function tick() {
      // Snapshot: activePollsRef can change (a stopPolling call below, or a
      // new run turn added mid-tick) while this tick's awaits are in flight.
      for (const experimentId of [...activePollsRef.current]) {
        const state = pollStateRef.current.get(experimentId) ?? { attempts: 0, consecutiveErrors: 0 };
        state.attempts += 1;

        const result = await getExperimentProgress(experimentId);

        if ("error" in result) {
          state.consecutiveErrors += 1;
          pollStateRef.current.set(experimentId, state);
          if (state.consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
            stopPolling(
              experimentId,
              "Lost track of this experiment's progress — refresh the page to check its latest status.",
            );
          }
          continue;
        }

        state.consecutiveErrors = 0;
        pollStateRef.current.set(experimentId, state);

        setTurns((current) =>
          current.map((turn) =>
            turn.kind === "run" && turn.experimentId === experimentId
              ? { ...turn, steps: computeStepCards(result.progress) }
              : turn,
          ),
        );

        if (result.progress.status && TERMINAL_STATUSES.has(result.progress.status)) {
          stopPolling(experimentId);
          router.refresh();
          continue;
        }

        if (state.attempts >= MAX_POLL_ATTEMPTS) {
          stopPolling(
            experimentId,
            "This is taking longer than expected — refresh the page to check its latest status.",
          );
        }
      }

      if (!cancelled && activePollsRef.current.length > 0) {
        timeoutId = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }

    timeoutId = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [activePolls.length, router]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, 6);
    setFiles(next);
    setPreviews(next.map((file) => URL.createObjectURL(file)));
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
    setPreviews((current) => current.filter((_, i) => i !== index));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || pending) return;

    setError(null);
    setPending(true);

    const formData = new FormData();
    formData.set("prompt", prompt);
    formData.set("image_count", String(files.length));
    const result = await startExperiment(formData);

    if ("error" in result) {
      // Leave the draft (and any attached images) in place — the user's
      // wording is almost certainly what they still want to send, e.g. after
      // a parse failure they just need to add a bit more detail, not retype
      // the whole thing from scratch.
      setError(result.error);
      setPending(false);
      return;
    }

    setDraft("");
    setFiles([]);
    setPreviews([]);

    // Every prompt starts its own experiment (its own hypothesis, PR, and
    // flag) — it is never a continuation of whatever chat happened to be
    // open. Navigating to it (rather than appending to the currently
    // rendered turns) is what actually switches the view AND the sidebar's
    // highlighted item to the new chat; without this, sending a message
    // while viewing an older chat silently created a new experiment that
    // only showed up as a second, confusing sidebar entry.
    router.push(`/?experiment=${result.experimentId}`);
    setPending(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pt-6 pb-4">
        {turns.length === 0 ? (
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
          turns.map((turn) =>
            turn.kind === "user" ? (
              <div key={turn.id} className="rise-fast flex justify-end">
                <div className="max-w-[75%] rounded-2xl bg-ink px-3.5 py-2 text-ticket">
                  <p className="m-0 text-[14px] leading-snug">{turn.text}</p>
                  {turn.images.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {turn.images.map((src) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={src} src={src} alt="" className="h-11 w-11 rounded-md object-cover" />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div key={turn.id} className="flex flex-col gap-1.5">
                {turn.steps.map((card) => (
                  <div
                    key={`${turn.id}-${card.step}`}
                    className="rise-fast flex items-center gap-2.5 rounded-lg border border-rule/40 bg-ticket/60 px-2.5 py-1.5"
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-200",
                        card.status === "error"
                          ? "border-[#C23A2B] text-[#C23A2B]"
                          : card.status === "done"
                            ? "border-ink bg-ink text-ticket"
                            : "border-rule text-mute",
                      )}
                    >
                      {card.status === "revealing" ? (
                        <Loader2 className="size-2.5 animate-spin" strokeWidth={2} />
                      ) : card.status === "done" ? (
                        <Check className="size-2.5" strokeWidth={2.5} />
                      ) : (
                        <X className="size-2.5" strokeWidth={2.5} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 flex items-center gap-1 font-mono text-[9px] tracking-[0.08em] text-mute uppercase">
                        {(() => {
                          const Icon = STEP_META[card.step].icon;
                          return <Icon className="size-2.5" strokeWidth={1.75} />;
                        })()}
                        {STEP_META[card.step].label}
                      </p>
                      <p className="m-0 truncate text-[12.5px] leading-snug">{card.message}</p>
                    </div>
                  </div>
                ))}
                {turn.giveUpMessage ? (
                  <p className="m-0 font-mono text-[11px] leading-snug text-[#C23A2B]">
                    {turn.giveUpMessage}
                  </p>
                ) : null}
              </div>
            ),
          )
        )}
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 bg-transparent pt-2">
        {previews.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {previews.map((src, index) => (
              <div key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-11 w-11 rounded-md object-cover" />
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-ink text-ticket"
                  aria-label="Remove image"
                >
                  <X className="size-2.5" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="mb-2 font-mono text-xs text-[#C23A2B]">{error}</p>
        ) : null}
        <div className="flex items-end gap-1 rounded-full border border-rule bg-ticket px-1.5 py-1">
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
            className="grid size-8 shrink-0 place-items-center rounded-full text-mute transition duration-100 hover:text-ink active:scale-90"
            aria-label="Attach images"
          >
            <ImagePlus className="size-4" strokeWidth={1.75} />
          </button>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            placeholder="I want to try a different CTA copy on the signup screen…"
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[14px] outline-none"
          />
          <button
            type="submit"
            disabled={pending || !draft.trim()}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-ticket transition duration-100 active:scale-90 disabled:opacity-40 disabled:active:scale-100"
            aria-label="Send"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <Send className="size-3.5" strokeWidth={1.75} />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
